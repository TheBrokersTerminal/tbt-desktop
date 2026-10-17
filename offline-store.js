/* Offline copies for the desktop app.
   Every GET the terminal makes while online is fetched live (nothing changes for the user) and a copy is
   kept on this computer, encrypted with a key held in the system keychain (macOS Keychain / Windows DPAPI).
   When the network is down, the last copy is served instead and the windows are told when it was saved.
   - The user's own data (database reads, their reports) is kept apart and wiped on sign-out or when a
     different person signs in on this computer.
   - Nothing is ever sent anywhere; POSTs (AI, payments, credits) are never stored or replayed. */
const { app, safeStorage, BrowserWindow } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = () => path.join(app.getPath('userData'), 'offline');
const MAX_FILE = 40 * 1024 * 1024;          /* one response */
const MAX_TOTAL = 2 * 1024 * 1024 * 1024;   /* everything kept: 2 GB, oldest dropped first */
const FORCE_OFFLINE = process.env.TBT_FORCE_OFFLINE === '1';   /* for testing only */

let KEY = null, user = null, lastOnline = null, offlineNow = false, lastTold = 0;

function dir(sub) { const d = path.join(ROOT(), sub); fs.mkdirSync(d, { recursive: true }); return d; }
function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }

function init() {
  dir('p'); dir('u');
  if (!safeStorage.isEncryptionAvailable()) return false;   /* no keychain: run online-only */
  const kf = path.join(ROOT(), 'key.bin');
  try { KEY = Buffer.from(safeStorage.decryptString(fs.readFileSync(kf)), 'base64'); } catch (e) { KEY = null; }
  if (!KEY || KEY.length !== 32) {
    KEY = crypto.randomBytes(32);
    fs.writeFileSync(kf, safeStorage.encryptString(KEY.toString('base64')));
    wipe('p'); wipe('u');   /* old copies cannot be read with a new key */
  }
  const st = readJSON(path.join(ROOT(), 'state.json'), {});
  user = st.user || null; lastOnline = st.lastOnline || null;
  setTimeout(prune, 20000);
  return true;
}
function saveState() { try { fs.writeFileSync(path.join(ROOT(), 'state.json'), JSON.stringify({ user, lastOnline })); } catch (e) { /* not critical */ } }
function wipe(sub) { try { fs.rmSync(path.join(ROOT(), sub), { recursive: true, force: true }); } catch (e) { /* nothing to remove */ } dir(sub); }

function enc(buf) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const out = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), out]); }
function dec(buf) { const c = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12)); c.setAuthTag(buf.subarray(12, 28)); return Buffer.concat([c.update(buf.subarray(28)), c.final()]); }

/* whose data a request carries: the signed-in user's id from the sign-in pass, never sent anywhere */
function subOf(req) {
  const a = req.headers.get('authorization') || '';
  const m = /^Bearer\s+([^.]+)\.([^.]+)\./.exec(a);
  if (!m) return null;
  try { const p = JSON.parse(Buffer.from(m[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); return p.role === 'authenticated' && p.sub ? p.sub : null; } catch (e) { return null; }
}
function personal(url, req) {
  return /\.supabase\.co$/.test(url.hostname) || (!!req.headers.get('authorization') && /thebrokersterminal\.com$/.test(url.hostname));
}
function keyFor(url) {
  const u = new URL(url.href);
  if (/\.supabase\.co$/.test(u.hostname) && u.pathname.indexOf('/storage/') === 0) u.searchParams.delete('token');   /* signed links change; the file does not */
  ['_', 't', 'ts', 'nocache', 'cb'].forEach((k) => u.searchParams.delete(k));
  u.hash = '';
  return crypto.createHash('sha256').update(u.href).digest('hex');
}

/* POSTs that only read: kept like GETs (keyed by what was asked) so reports and team figures open offline */
const READ_POST = /^\/(rest\/v1\/rpc\/(vault_comment_counts|vault_team|vault_firm_reads|learning_team_summary|is_firm_admin|chat_overview)|\.netlify\/functions\/report-file)$/;
function readPost(url, req) { return req.method === 'POST' && READ_POST.test(url.pathname); }
function skip(url, req) {
  if (req.method !== 'GET' && !readPost(url, req)) return true;
  if (req.headers.get('range')) return true;                        /* video and audio streams */
  if (/\.supabase\.co$/.test(url.hostname) && /^\/(auth|realtime)\//.test(url.pathname)) return true;
  if (/(^|\.)stripe\.com$/.test(url.hostname)) return true;
  if (/^\/(sw\.js|whats-new\.json)$/.test(url.pathname)) return true;
  return false;
}

function tell(force) {
  const now = Date.now(); if (!force && now - lastTold < 1500) return; lastTold = now;
  BrowserWindow.getAllWindows().forEach((w) => { try { w.webContents.send('tbt-net', { offline: offlineNow, lastOnline }); } catch (e) { /* window closing */ } });
}
function online() { lastOnline = new Date().toISOString(); if (offlineNow) { offlineNow = false; tell(true); } if (Math.random() < 0.05) saveState(); }
function offline() { if (!offlineNow) { offlineNow = true; saveState(); tell(true); } else tell(false); }

function put(sub, key, res, body) {
  try {
    const headers = {}; res.headers.forEach((v, k) => { if (!/^(content-encoding|content-length|transfer-encoding|set-cookie)$/i.test(k)) headers[k] = v; });
    const meta = Buffer.from(JSON.stringify({ s: res.status, h: headers, at: new Date().toISOString() }));
    const len = Buffer.alloc(4); len.writeUInt32BE(meta.length);
    fs.writeFileSync(path.join(dir(sub), key), enc(Buffer.concat([len, meta, body])));
  } catch (e) { /* a copy that cannot be written is simply not kept */ }
}
function get(sub, key) {
  try {
    const raw = dec(fs.readFileSync(path.join(ROOT(), sub, key)));
    const n = raw.readUInt32BE(0); const meta = JSON.parse(raw.subarray(4, 4 + n).toString());
    return { status: meta.s, headers: meta.h, at: meta.at, body: raw.subarray(4 + n) };
  } catch (e) { return null; }
}
/* files that never change once published: served from the kept copy without asking again
   (report files in storage, versioned scripts and styles, brand images) */
function fixedFile(url) {
  if (/\.supabase\.co$/.test(url.hostname) && /^\/storage\/v1\/object\/(sign|public|authenticated)\/Reports\//.test(url.pathname)) return true;
  if (/thebrokersterminal\.com$/.test(url.hostname) && (/^\/brand\//.test(url.pathname) || (/\.(js|css)$/.test(url.pathname) && url.searchParams.has('v')))) return true;
  return false;
}
function cleanHeaders(h) { const out = new Headers(); h.forEach((v, k) => { if (!/^(content-encoding|content-length|transfer-encoding)$/i.test(k)) out.append(k, v); }); return out; }

/* the session's https handler: live first, the kept copy only when the network is down */
/* opts.freshFor (ms): serve a kept copy younger than this without going to the network (the daily download) */
function handler(ses, opts) {
  opts = opts || {};
  return async (req) => {
    const url = new URL(req.url);
    if (!KEY || skip(url, req)) return ses.fetch(req, { bypassCustomProtocolHandlers: true });
    const rp = readPost(url, req), sent = rp ? Buffer.from(await req.arrayBuffer()) : null;
    const mine = personal(url, req), sub = mine ? 'u' : 'p';
    const key = rp ? crypto.createHash('sha256').update(keyFor(url) + '|' + sent.toString('base64')).digest('hex') : keyFor(url);
    if (req.url.indexOf('/auth/v1/logout') > 0) { user = null; wipe('u'); saveState(); }
    /* never fetch twice what cannot change; the daily download skips anything saved recently */
    if (!rp && (fixedFile(url) || opts.freshFor)) {
      const kept = get(sub, key);
      if (kept && (fixedFile(url) || Date.now() - Date.parse(kept.at) < opts.freshFor)) { const h = new Headers(kept.headers); h.set('x-tbt-saved-at', kept.at); return new Response(kept.body, { status: kept.status, headers: h }); }
    }
    try {
      if (FORCE_OFFLINE) throw new Error('offline (test)');
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
      const res = await ses.fetch(req.url, { method: rp ? 'POST' : 'GET', headers: req.headers, body: rp ? sent : undefined, signal: ctl.signal, bypassCustomProtocolHandlers: true });
      clearTimeout(t);
      online();
      if (mine) { const s = subOf(req); if (s && s !== user) { if (user) wipe('u'); user = s; saveState(); } }
      const type = res.headers.get('content-type') || '', size = +(res.headers.get('content-length') || 0);
      if (res.status !== 200 || /^(video|audio)\//.test(type) || size > MAX_FILE || (mine && !user)) return new Response(res.body, { status: res.status, statusText: res.statusText, headers: cleanHeaders(res.headers) });
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length <= MAX_FILE) put(sub, key, res, body);
      return new Response(body, { status: res.status, statusText: res.statusText, headers: cleanHeaders(res.headers) });
    } catch (e) {
      /* the terminal sometimes asks without its sign-in pass while offline: look in both places on our own site */
      const hit = get(sub, key) || (/thebrokersterminal\.com$/.test(url.hostname) ? get(sub === 'u' ? 'p' : 'u', key) : null);
      offline();
      if (!hit) throw e;
      const h = new Headers(hit.headers); h.set('x-tbt-saved-at', hit.at);
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  };
}

/* keep the store under its size limit, dropping the copies used longest ago */
function prune() {
  try {
    const all = [];
    ['p', 'u'].forEach((s) => fs.readdirSync(dir(s)).forEach((f) => { const p = path.join(ROOT(), s, f); const st = fs.statSync(p); all.push({ p, size: st.size, t: st.mtimeMs }); }));
    let total = all.reduce((a, x) => a + x.size, 0);
    all.sort((a, b) => a.t - b.t);
    while (total > MAX_TOTAL && all.length) { const x = all.shift(); fs.rmSync(x.p, { force: true }); total -= x.size; }
  } catch (e) { /* tried again next launch */ }
}

function status() { return { offline: offlineNow, lastOnline }; }
function signedOut() { user = null; wipe('u'); saveState(); }

module.exports = { init, handler, status, signedOut, tell, READ_POST };

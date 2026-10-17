/* Daily offline download: once a day, while online, the app opens every terminal in a hidden window,
   clicks through its pages and saves what it loads (offline-store.js keeps the copies), then saves the
   newest 30 Vault reports. So every terminal works offline, not only the ones the subscriber opened.

   The hidden window can only READ. It runs in its own session, which:
   - refuses every write (no workspace, notes, usage records, presence or sign-in changes),
   - refuses everything that costs money or spends TBT (Intel, AI, paid look-ups, payments),
   - never renews the sign-in pass (renewing it here would sign the main window out), so it only
     runs while the pass has more than 25 minutes left,
   - is muted, shows no notifications and never navigates away from the terminal. */
const { BrowserWindow, session, ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./offline-store');

const PART = 'persist:tbt-warm';
const HOME = 'https://thebrokersterminal.com/dashboard.html';
const EVERY = 20 * 3600 * 1000;
/* functions that charge TBT, call AI, or write: never touched by the background download */
const PAID = /^\/\.netlify\/functions\/(search|search-stream|explain|explain-figure|coins|company-news|cask-prices|client-holdings|event-museum|event-museum-background|monthly-report|sales-toolkit|whisky-data|broker-product|broker-product-background|credits|stripe-credits|firm-billing|billing-portal|send-invite|feedback|notify-api|vault-brief|news-angles|metals-brief|security-search|report-market|broker-monthly|catalyst-watch|land-own|alerts-check|key-check)(\/|$)/;
/* the terminals to visit (the command bar's own list, minus live TV and chat) */
const TYPES = ['estate_terminal', 'mortgage_terminal', 'insurance_terminal', 'pension_terminal', 'invest_terminal', 'property_terminal',
  'business_cycle', 'macro_intel', 'macro_monitor', 'call_signal', 'distress', 'sector_heatmap', 'global_map', 'econ_calendar',
  'gold_intel', 'metals_monitor', 'wine_terminal', 'art_terminal', 'rich_terminal', 'whisky_lookup', 'whisky_monitor',
  'news', 'reports', 'notes', 'notes_inbox', 'clients', 'calendar', 'saved_intel', 'analogy_lib'];
const STATE = () => path.join(app.getPath('userData'), 'offline', 'warm.json');

let running = false, ids = new Set(), wired = false;
/* every window asks once, as its page starts, whether it is the hidden download window */
ipcMain.on('tbt-is-warm', (e) => { e.returnValue = ids.has(e.sender.id); });
function readState() { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch (e) { return {}; } }
function progress(done, total) { BrowserWindow.getAllWindows().forEach((w) => { try { if (!ids.has(w.webContents.id)) w.webContents.send('tbt-warm', { done, total }); } catch (e) { /* closing */ } }); }
function writeState(s) { try { fs.writeFileSync(STATE(), JSON.stringify(s)); } catch (e) { /* not critical */ } }

function wire() {
  if (wired) return; wired = true;
  const ses = session.fromPartition(PART);
  const base = store.handler(ses, { freshFor: 20 * 3600 * 1000 });   /* only fetch what is missing or more than 20 hours old */
  ses.protocol.handle('https', async (req) => {
    const u = new URL(req.url);
    const read = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || (req.method === 'POST' && store.READ_POST.test(u.pathname));
    if (!read || PAID.test(u.pathname) || /\/auth\/v1\//.test(u.pathname) || req.headers.get('range') || /(^|\.)(youtube|youtu|ytimg|googlevideo|spotify|vimeo|twitch)\./.test(u.hostname) || /(^|\.)stripe\.com$/.test(u.hostname)) {
      return new Response('{}', { status: 204 });
    }
    return base(req);
  });
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setUserAgent(session.fromPartition('persist:tbt').getUserAgent());
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function evalIn(wc, js, ms) {
  return Promise.race([wc.executeJavaScript(js, true), wait(ms).then(() => 'timeout')]).catch((e) => 'error: ' + e.message);
}

/* the sign-in the main window holds, copied (never renewed) */
async function signIn() {
  const w = BrowserWindow.getAllWindows().find((x) => !ids.has(x.webContents.id) && /^https:\/\/(www\.)?thebrokersterminal\.com\//.test(x.webContents.getURL()));
  if (!w) return null;
  const raw = await evalIn(w.webContents, 'JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter(function (k) { return /^sb-.*-auth-token$|^sessionId$|^firmId$|^userEmail$|^tbt_asset_lens$/.test(k); }).map(function (k) { return [k, localStorage.getItem(k)]; })))', 5000);
  let keys; try { keys = JSON.parse(raw); } catch (e) { return null; }
  const tk = Object.keys(keys).find((k) => /-auth-token$/.test(k));
  if (!tk) return null;
  let exp = 0; try { exp = JSON.parse(keys[tk]).expires_at * 1000; } catch (e) { exp = 0; }
  return { keys, minutesLeft: (exp - Date.now()) / 60000 };
}

function terminalScript(type) {
  return `(async function (type) {
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    if (!window._tbtWarmRender) return 'no-render';
    var body; try { body = window._tbtWarmRender(type); } catch (e) { return 'error: ' + e.message; }
    if (!body) return 'no-body';
    await sleep(6000);
    var seen = {}, clicks = 0, SEL = '[role="tab"],[data-tab],[data-page],[data-sub],[data-view],[data-pg],[data-amk]';
    async function sweep(depth) {
      var els = Array.prototype.slice.call(body.querySelectorAll(SEL));
      for (var i = 0; i < els.length && clicks < 45; i++) {
        var el = els[i]; if (!el.isConnected) continue;
        var href = el.getAttribute('href'); if (href && href.charAt(0) !== '#') continue;
        var k = depth + '|' + (el.getAttribute('data-tab') || el.getAttribute('data-page') || el.getAttribute('data-sub') || el.getAttribute('data-view') || el.getAttribute('data-pg') || el.getAttribute('data-amk') || el.textContent || '').slice(0, 60);
        if (seen[k]) continue; seen[k] = 1;
        try { el.click(); } catch (e) {}
        clicks++; await sleep(1600);
        if (depth < 1) await sweep(depth + 1);
      }
    }
    await sweep(0);
    try { var w = body.closest('.tbc-widget'); if (w) w.remove(); } catch (e) {}
    return 'ok ' + clicks;
  })(${JSON.stringify(type)})`;
}
const REPORTS = `(async function () {
  if (!window._sbDash || !window._tbtReportFetch) return 'no-vault';
  var q = await window._sbDash.from('reports').select('file_path').order('created_at', { ascending: false }).limit(30);
  if (q.error) q = await window._sbDash.from('reports').select('file_path').limit(30);
  var n = 0;
  for (var r of (q.data || [])) { if (!r.file_path) continue; try { var res = await window._tbtReportFetch(r.file_path); await res.arrayBuffer(); n++; } catch (e) {} }
  return 'reports ' + n;
})()`;

async function run(force) {
  if (running) return 'already running';
  const st = readState();
  if (!force && st.at && Date.now() - Date.parse(st.at) < EVERY) return 'done recently';
  if (store.status().offline) return 'offline';
  const si = await signIn();
  if (!si) { writeState(Object.assign(st, { tried: new Date().toISOString(), result: 'not signed in' })); return 'not signed in'; }
  if (si.minutesLeft < 25) { writeState(Object.assign(st, { tried: new Date().toISOString(), result: 'sign-in renewing soon' })); return 'sign-in renewing soon'; }
  running = true; wire();
  const log = [];
  const win = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { partition: PART, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const wc = win.webContents; ids.add(wc.id);
  try {
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    let ready = false;
    wc.on('will-navigate', (e) => { if (ready) e.preventDefault(); });
    await win.loadURL('https://thebrokersterminal.com/favicon.svg');
    await evalIn(wc, 'var o = ' + JSON.stringify(si.keys) + '; Object.keys(o).forEach(function (k) { localStorage.setItem(k, o[k]); }); 1', 5000);
    await win.loadURL(HOME);
    for (let i = 0; i < 45; i++) { if ((await evalIn(wc, '!!(window._tbtWarmRender && window._sbDash && /dashboard/.test(location.pathname))', 3000)) === true) { ready = true; break; } await wait(1000); }
    if (!ready) { log.push('terminal did not open'); writeState(Object.assign(st, { tried: new Date().toISOString(), result: log.join('; ') })); return log.join('; '); }
    await wait(5000);
    const total = TYPES.length + 1; let done = 0, stopped = false;
    progress(0, total);
    for (const t of TYPES) {
      if (store.status().offline) { log.push('stopped: offline'); stopped = true; break; }
      log.push(t + ': ' + (await evalIn(wc, terminalScript(t), 150000)));
      progress(++done, total);
    }
    if (!stopped) { log.push(await evalIn(wc, REPORTS, 600000)); progress(total, total); }
    writeState(stopped ? Object.assign(st, { tried: new Date().toISOString(), result: log.join('; ') }) : { at: new Date().toISOString(), log });
    return log.join('; ');
  } catch (e) {
    return 'error: ' + e.message;
  } finally {
    ids.delete(wc.id); running = false; progress(-1, 0);
    try { win.destroy(); } catch (e) { /* already closed */ }
  }
}

function schedule() {
  /* the first download starts within a minute (sign-in permitting); after that, daily */
  setTimeout(() => run(false), (readState().at ? 3 * 60 : 45) * 1000);
  setTimeout(() => run(false), 4 * 60 * 1000);
  setInterval(() => run(false), 60 * 60 * 1000);
}
function lastRun() { return readState().at || null; }

module.exports = { run, schedule, lastRun, isRunning: () => running };

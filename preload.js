/* The desktop app's own touches to the terminal pages (nothing here changes the website for browsers):
   - lets the terminal know it is running inside the app;
   - the terminal's top bar becomes the window's title bar (drag to move; window buttons sit in its corner);
   - the sign-in page shows only the sign-in box on the terminal's grid, no website menu or links;
   - the top-left logo stays in the terminal instead of opening the website;
   - the offline bar. */
const { contextBridge, ipcRenderer } = require('electron');
const MAC = process.platform === 'darwin';
let net = { offline: false, lastOnline: null };
let WARM = false; try { WARM = ipcRenderer.sendSync('tbt-is-warm') === true; } catch (e) { WARM = false; }
contextBridge.exposeInMainWorld('TBTDesktop', { app: true, warm: WARM, platform: process.platform, offline: () => net.offline, lastOnline: () => net.lastOnline });

const CSS = `
html.tbt-app #tbc-topbar { -webkit-app-region: drag; }
html.tbt-app #tbc-topbar :is(a, button, input, select, textarea, label, summary, [onclick], [role="button"], [tabindex], .ttb-lens, .ttb-lens-dropdown, #ttb-user-dropdown) { -webkit-app-region: no-drag; }
html.tbt-mac body:not(.tbm) #tbc-topbar .ttb-left { padding-left: 86px !important; }
html.tbt-win body:not(.tbm) #tbc-topbar { padding-right: 140px !important; }
html.tbt-app #tbc-topbar .ttb-logo { cursor: default; }
html.tbt-app #tbc-topbar :is(.ttb-logo-txt, .ttb-logo-short) { display: none !important; }
html.tbt-app body:not(.tbm) #tbc-topbar .ttb-emblem { width: 24px !important; height: 28px !important; }
html.tbt-app .tbt-drag { position: fixed; top: 0; left: 0; right: 0; height: 40px; -webkit-app-region: drag; z-index: 2147483646; }
html.tbt-app body.w-auth .w-nav, html.tbt-app body.w-auth .w-foot, html.tbt-app body.w-auth .form-links .sep, html.tbt-app body.w-auth .form-links a[href*="pricing"], html.tbt-app body.w-auth .form-links a[href*="signup"] { display: none !important; }
html.tbt-app body.w-auth { background-color: #141414 !important; }
html.tbt-app body.w-auth .form-wrap { min-height: 100vh !important; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 16px; box-sizing: border-box; gap: 44px; }
html.tbt-app body.w-auth .form-panel { background: transparent !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; width: 340px; max-width: 100%; }
html.tbt-app body.w-auth :is(.form-title, .form-subtitle, .form-intro) { display: none !important; }
html.tbt-app body.w-auth .form-group { margin-bottom: 26px !important; }
html.tbt-app body.w-auth .form-label { font: 500 11px "IBM Plex Mono", Menlo, Consolas, monospace !important; letter-spacing: .32em !important; text-transform: uppercase !important; color: #fff !important; margin-bottom: 10px !important; display: block; }
html.tbt-app body.w-auth .form-input { background: transparent !important; border: 0 !important; border-bottom: 1px solid #4a4a4a !important; border-radius: 0 !important; color: #fff !important; font: 15px "Helvetica Neue", Helvetica, Arial, sans-serif !important; padding: 10px 2px !important; box-shadow: none !important; }
html.tbt-app body.w-auth .form-input:focus { border-bottom-color: #E97132 !important; outline: none !important; }
html.tbt-app body.w-auth .form-input::placeholder { color: transparent !important; }
html.tbt-app body.w-auth .form-group button[type="button"] { background: transparent !important; border: 0 !important; font: 500 10px "IBM Plex Mono", Menlo, monospace !important; letter-spacing: .2em !important; text-transform: uppercase !important; color: #fff !important; }
html.tbt-app body.w-auth .btn-submit { background: transparent !important; border: 1px solid #E97132 !important; color: #fff !important; font: 500 12px "IBM Plex Mono", Menlo, monospace !important; letter-spacing: .4em !important; text-transform: uppercase !important; padding: 15px !important; margin-top: 14px !important; }
html.tbt-app body.w-auth .btn-submit:hover { background: #E97132 !important; }
html.tbt-app body.w-auth .form-links { margin-top: 30px !important; text-align: center; }
html.tbt-app body.w-auth .form-links a { font: 500 10px "IBM Plex Mono", Menlo, monospace !important; letter-spacing: .24em !important; text-transform: uppercase !important; color: #fff !important; text-decoration: none !important; }
html.tbt-app .tbt-app-brand { display: flex; flex-direction: column; align-items: center; gap: 22px; }
html.tbt-app .tbt-app-brand img { width: 92px; height: 108px; display: block; }
html.tbt-app .tbt-app-brand span { font: 600 15px/1.5 "Cormorant Garamond", Georgia, serif; letter-spacing: .42em; padding-left: .42em; color: #fff; text-align: center; }
`;

function when(iso) {
  if (!iso) return 'your last connection';
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return t + ' today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t + ' yesterday';
  return t + ' on ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}
let warmP = null;
function pill(id) {
  const top = document.getElementById('tbc-topbar'); if (!top) return null;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div'); el.id = id; el.setAttribute('role', 'status');
    el.style.cssText = 'display:flex;align-items:center;align-self:center;height:24px;margin:0 8px;padding:0 9px;border:1px solid #E97132;color:#fff;font:600 10.5px "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.12em;white-space:nowrap;flex-shrink:0;-webkit-app-region:no-drag;';
    const clock = top.querySelector('.ttb-clock'); if (clock && clock.parentNode) clock.parentNode.insertBefore(el, clock); else top.appendChild(el);
  }
  return el;
}
function bar() {
  let b = document.getElementById('tbt-offline-bar'), p = document.getElementById('tbt-offline-pill');
  if (location.protocol === 'file:' || !net.offline) { if (b) b.remove(); if (p) p.remove(); return; }
  if (!document.body) return;
  const say = 'Showing the figures saved at ' + when(net.lastOnline) + '. Live prices, Intel, news and chat return when you reconnect.';
  /* in the terminal: a small marker in the top bar, so nothing on the workspace is covered */
  const pl = pill('tbt-offline-pill');
  if (pl) {
    if (b) b.remove();
    const t = net.lastOnline ? new Date(net.lastOnline).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    pl.style.background = '#E97132'; pl.textContent = 'OFFLINE' + (t ? ' · SAVED ' + t : ''); pl.title = say;
    return;
  }
  /* other pages (sign-in): a bar along the bottom */
  if (!b) {
    b = document.createElement('div'); b.id = 'tbt-offline-bar'; b.setAttribute('role', 'status');
    b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#2b2b2b;border-top:2px solid #E97132;color:#fff;font:600 13px "Helvetica Neue",Helvetica,Arial,sans-serif;padding:9px 16px;display:flex;gap:14px;align-items:center;';
    document.body.appendChild(b);
  }
  b.innerHTML = '';
  const a = document.createElement('span'); a.style.cssText = 'color:#E97132;letter-spacing:.14em;font-size:11px;'; a.textContent = 'OFFLINE';
  const t = document.createElement('span'); t.style.fontWeight = '400'; t.textContent = say;
  b.append(a, t);
}
function warmPill() {
  const el = document.getElementById('tbt-warm-pill');
  if (!warmP || warmP.done < 0 || net.offline) { if (el) el.remove(); return; }
  const p = pill('tbt-warm-pill'); if (!p) return;
  p.style.background = 'transparent';
  p.textContent = warmP.done >= warmP.total ? 'SAVED FOR OFFLINE' : 'SAVING FOR OFFLINE ' + warmP.done + '/' + warmP.total;
  p.title = 'The app is saving every terminal and the latest reports so they open without internet. Keep working as normal.';
  if (warmP.done >= warmP.total) setTimeout(() => { const x = document.getElementById('tbt-warm-pill'); if (x) x.remove(); }, 8000);
}
ipcRenderer.on('tbt-warm', (e, s) => { warmP = s; warmPill(); });

function dress() {
  const root = document.documentElement;
  root.classList.add('tbt-app', MAC ? 'tbt-mac' : 'tbt-win');
  if (!document.getElementById('tbt-app-css')) { const st = document.createElement('style'); st.id = 'tbt-app-css'; st.textContent = CSS; document.head.appendChild(st); }
  /* pages without the terminal's top bar still need somewhere to grab the window */
  if (!document.getElementById('tbc-topbar') && !document.querySelector('.tbt-drag')) { const d = document.createElement('div'); d.className = 'tbt-drag'; d.setAttribute('aria-hidden', 'true'); document.body.appendChild(d); }
  /* the top-left logo stays in the terminal */
  const logo = document.querySelector('#tbc-topbar .ttb-logo');
  if (logo) { logo.removeAttribute('href'); logo.addEventListener('click', (e) => e.preventDefault()); }
  /* the sign-in page: the emblem and name above the box */
  const wrap = document.querySelector('body.w-auth .form-wrap');
  if (wrap && !wrap.querySelector('.tbt-app-brand')) {
    const b = document.createElement('div'); b.className = 'tbt-app-brand';
    const img = document.createElement('img'); img.src = '/brand/tbt-mark.svg'; img.alt = '';
    img.alt = 'The Brokers Terminal';
    b.append(img); wrap.insertBefore(b, wrap.firstChild);
  }
  /* the sign-in page, private-members style: emblem, username, password, enter */
  if (wrap) {
    const em = document.querySelector('label[for="email"]'); if (em) em.textContent = 'Username';
    const sub = document.querySelector('body.w-auth .btn-submit'); if (sub && /log in/i.test(sub.textContent)) sub.textContent = 'Enter';
    const fp = document.getElementById('forgot-password-link'); if (fp) fp.textContent = 'Forgotten password';
    if (!document.getElementById('tbt-mono-font')) { const l = document.createElement('link'); l.id = 'tbt-mono-font'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&display=swap'; document.head.appendChild(l); }
  }
  bar();
}
ipcRenderer.on('tbt-net', (e, s) => { net = s || net; bar(); });
window.addEventListener('DOMContentLoaded', dress);
window.addEventListener('online', () => setTimeout(bar, 500));

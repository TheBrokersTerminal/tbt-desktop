/* The Brokers Terminal — desktop app.
   A native window around the live terminal (thebrokersterminal.com), so every update to the
   terminal reaches desktop users the moment it is published, with no reinstall.
   - One persistent session: subscribers stay signed in between launches.
   - Pages on our own site open inside the app; the terminal's "New window" panels open as
     real app windows (for second screens). Everything else opens in the user's browser.
   - Window size and position are remembered; a calm offline page appears without internet. */
const { app, BrowserWindow, Menu, shell, session, nativeTheme, screen, Notification } = require('electron');
const store = require('./offline-store');
const warm = require('./warm');
const path = require('path');
const fs = require('fs');

const HOME = 'https://thebrokersterminal.com/dashboard.html';
const PARTITION = 'persist:tbt';
const BG = '#1a1a1a';
/* hosts that stay inside the app: our site, sign-in/data, and card payments */
/* the public website's own pages open in the user's browser, never inside the app */
const SITE_PAGES = /^\/(|index|pricing|platform|assets|intel|signup|download|gold-history|whisky-history|wine-history|art-history|brand\/signature|brand\/report-cover)(\.html)?$/;
const INSIDE = [/^thebrokersterminal\.com$/, /^www\.thebrokersterminal\.com$/, /\.supabase\.co$/, /(^|\.)stripe\.com$/];

app.setName('The Brokers Terminal');
/* a separate profile for testing, so a test never touches a subscriber's own sign-in */
if (process.env.TBT_PROFILE) app.setPath('userData', process.env.TBT_PROFILE);
nativeTheme.themeSource = 'dark';

function inside(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'blob:' || u.protocol === 'about:') return true;
    if (u.protocol !== 'https:') return false;
    if (/thebrokersterminal\.com$/.test(u.hostname) && SITE_PAGES.test(u.pathname)) return false;
    return INSIDE.some((re) => re.test(u.hostname));
  } catch (e) { return false; }
}
function external(url) {
  try { const u = new URL(url); if (['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol)) shell.openExternal(url); } catch (e) { /* not a link */ }
}

/* remembered window bounds, kept on screen if a monitor has since been unplugged */
const STATE = path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const on = screen.getAllDisplays().some((d) => s.x >= d.bounds.x - 50 && s.y >= d.bounds.y - 50 && s.x < d.bounds.x + d.bounds.width && s.y < d.bounds.y + d.bounds.height);
    return on ? s : { width: s.width, height: s.height, maximized: s.maximized };
  } catch (e) { return { width: 1440, height: 900, maximized: true }; }
}
function saveState(win) {
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(STATE, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() }));
  } catch (e) { /* the size is simply not remembered */ }
}

function wire(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (inside(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { backgroundColor: BG, autoHideMenuBar: true, webPreferences: { partition: PARTITION, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } } };
    }
    external(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => wire(child));
  wc.on('will-navigate', (e, url) => { if (!inside(url)) { e.preventDefault(); external(url); } });
  wc.on('did-finish-load', () => store.tell(true));
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { to: url && url.startsWith('https://') ? url : HOME } });
  });
}

function createMain() {
  const st = loadState();
  const win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1440, height: st.height || 900,
    minWidth: 1024, minHeight: 640,
    /* no grey title bar: the terminal's own top bar is the top of the window (window buttons sit in it) */
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 17 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#262626', symbolColor: '#ffffff', height: 44 } }),
    backgroundColor: BG, show: false, title: 'The Brokers Terminal',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { partition: PARTITION, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  ['resize', 'move', 'close'].forEach((ev) => win.on(ev, () => saveState(win)));
  wire(win);
  win.loadURL(HOME);
  return win;
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  const focused = () => BrowserWindow.getFocusedWindow();
  const template = [
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New window', accelerator: 'CmdOrCtrl+N', click: () => createMain() },
      { label: 'Go to the terminal', accelerator: 'CmdOrCtrl+Shift+H', click: () => focused() && focused().loadURL(HOME) },
      { label: 'Save everything for offline now', click: async () => {
        const note = (b) => { try { new Notification({ title: 'The Brokers Terminal', body: b }).show(); } catch (e) { /* no notifications */ } };
        if (warm.isRunning()) return note('Already saving everything for offline. It carries on in the background.');
        note('Saving every terminal and the latest reports for offline use. This runs in the background and can take 20 to 30 minutes.');
        const r = await warm.run(true);
        note(/^error|not signed in|offline|did not open/.test(r) ? 'Offline save did not finish: ' + r + '.' : 'Every terminal is saved for offline use.');
      } },
      { type: 'separator' },
      mac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => focused() && focused().webContents.reload() },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'thebrokersterminal.com', click: () => shell.openExternal('https://thebrokersterminal.com') },
      { label: 'Email the desk', click: () => shell.openExternal('mailto:desk@thebrokersterminal.com') },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* AUTOMATIC UPDATES (18 Oct 2026). Installed copies check the download page for a newer version at start and every six
   hours, download it in the background and install it when the app is next closed, so a new icon or name reaches
   everyone without a fresh download. Only in installed copies (not when run from this folder). On a Mac the update has
   to carry the same signature as the installed copy: the first Developer ID release replaces the unsigned test copies once. */
function updates() {
  if (!app.isPackaged) return;
  let U; try { U = require('electron-updater').autoUpdater; } catch (e) { return; }
  U.autoDownload = true; U.autoInstallOnAppQuit = true;
  U.on('update-downloaded', (info) => { try { new Notification({ title: 'The Brokers Terminal', body: 'Version ' + info.version + ' is ready. It installs the next time you close the app.' }).show(); } catch (e) {} });
  U.on('error', (e) => console.warn('[updates]', e && e.message));
  const check = () => U.checkForUpdates().catch(() => {});
  setTimeout(check, 15000); setInterval(check, 6 * 3600 * 1000);
}

/* one copy of the app at a time: a second launch brings the open window forward */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    /* the terminal asks for notification permission; allow it, deny camera, mic and location */
    session.fromPartition(PARTITION).setPermissionRequestHandler((wc, permission, cb) => cb(['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission)));
    session.fromPartition(PARTITION).setUserAgent(session.fromPartition(PARTITION).getUserAgent() + ' TBTDesktop/' + app.getVersion());
    /* offline copies: live first, the kept copy when the network is down (see offline-store.js) */
    const ses = session.fromPartition(PARTITION);
    if (store.init()) ses.protocol.handle('https', store.handler(ses));
    buildMenu();
    createMain();
    warm.schedule();   /* the daily background download for offline use */
    updates();   /* new versions download quietly and install the next time the app is closed */
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createMain(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

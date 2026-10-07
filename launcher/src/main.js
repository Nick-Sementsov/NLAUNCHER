'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const paths = require('./core/paths');
const store = require('./core/store');
const auth = require('./core/auth');
const versions = require('./core/versions');
const panel = require('./core/panel');
const launcher = require('./core/launch');
const { ping } = require('./core/ping');

let win;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    backgroundColor: '#14100c',
    title: 'KM Launcher',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  if (process.env.KM_SCREENSHOT) {
    // служебный режим: снимок интерфейса для проверки сборки
    const [file, page] = process.env.KM_SCREENSHOT.split('#');
    const early = page === 'intro';
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (page && !early) await win.webContents.executeJavaScript(`document.querySelector('[data-page="${page}"]').click()`);
      setTimeout(async () => {
        require('fs').writeFileSync(file, (await win.webContents.capturePage()).toPNG());
        app.exit(0);
      }, early ? 0 : 800);
    }, early ? 1400 : 3500));
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // внешние ссылки открываем в браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});

app.whenReady().then(() => {
  createWindow();
  setupUpdater();
});

app.on('window-all-closed', () => app.quit());

function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-available', i => send('update:status', { state: 'downloading', version: i.version }));
    autoUpdater.on('update-downloaded', i => send('update:status', { state: 'ready', version: i.version }));
    autoUpdater.on('error', () => {});
    autoUpdater.checkForUpdates().catch(() => {});
    ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
  } catch { /* обновления недоступны */ }
}

// Обёртка: ошибки уходят в интерфейс понятным текстом
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}

handle('app:info', () => ({
  version: app.getVersion(),
  totalMemMb: Math.floor(os.totalmem() / 1024 / 1024),
  gameDir: paths.root,
  platform: process.platform,
}));

ipcMain.on('window:minimize', () => win?.minimize());
ipcMain.on('window:close', () => win?.close());

handle('settings:get', () => ({ ...store.get(), accounts: undefined }));
handle('settings:update', patch => {
  const allowed = ['selectedVersion', 'showSnapshots', 'memoryMb', 'resolution', 'closeOnLaunch', 'jvmArgs', 'panelUrl', 'theme', 'animations', 'intro'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  const s = store.update(clean);
  return { ...s, accounts: undefined };
});

handle('accounts:list', () => auth.list());
handle('accounts:addOffline', name => auth.addOffline(name));
handle('accounts:addMicrosoft', () => auth.addMicrosoft());
handle('accounts:remove', id => auth.remove(id));
handle('accounts:select', id => auth.select(id));

handle('versions:list', async showSnapshots => {
  const list = await versions.list(showSnapshots);
  let fabric = [];
  try { fabric = [...await versions.fabricGameVersions()]; } catch { /* Fabric недоступен */ }
  return { ...list, fabric };
});

handle('panel:config', () => panel.config());
handle('panel:news', () => panel.news());
handle('server:ping', address => ping(address));

handle('folder:open', async which => {
  const map = {
    root: paths.root,
    logs: paths.logs,
    instances: paths.instances,
  };
  let dir = map[which];
  if (!dir && typeof which === 'string' && which.startsWith('instance:')) {
    dir = path.join(paths.instances, which.slice(9).replace(/[^a-zA-Z0-9._-]/g, '_'));
    require('fs').mkdirSync(dir, { recursive: true });
  }
  if (!dir) throw new Error('Неизвестная папка');
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
});

handle('game:launch', async target => {
  const s = store.get();
  await launcher.launch(target, {
    onProgress: p => {
      send('launch:progress', p);
      if (p.started && s.closeOnLaunch) win?.hide();
    },
    onLog: line => send('launch:log', line),
    onExit: info => {
      if (win && !win.isVisible()) win.show();
      send('launch:exit', info);
    },
  });
});

handle('game:stop', () => launcher.stop());

process.on('uncaughtException', e => {
  console.error(e);
  if (win && !win.isDestroyed()) {
    dialog.showMessageBox(win, { type: 'error', title: 'KM Launcher', message: 'Внутренняя ошибка', detail: String(e?.stack || e) });
  }
});

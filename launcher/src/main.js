'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
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
const instances = require('./core/instances');
const modrinth = require('./core/modrinth');
const curseforge = require('./core/curseforge');
const { ping } = require('./core/ping');

let win;

// kmshot://shot/<сборка>/<файл> — превью скриншотов (только из папок screenshots)
protocol.registerSchemesAsPrivileged([{ scheme: 'kmshot', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

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
      if (process.env.KM_SCREENSHOT_JS) await win.webContents.executeJavaScript(process.env.KM_SCREENSHOT_JS);
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
  protocol.handle('kmshot', req => {
    const [id, file] = new URL(req.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!/^[a-z0-9-]+$/.test(id || '') || !/^[^\\/]+\.png$/i.test(file || '')) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(path.join(paths.instances, id, 'screenshots', file)).toString());
  });
  createWindow();
  setupUpdater();
});

app.on('window-all-closed', () => app.quit());

// последнее состояние обновления: окно могло ещё не загрузиться, когда оно пришло
let updateState = null;
function sendUpdate(st) { updateState = st; send('update:status', st); }
handle('update:state', () => updateState);

function setupUpdater() {
  // для проверки окна обновления без настоящего релиза: KM_FAKE_UPDATE=1.9.0
  if (process.env.KM_FAKE_UPDATE) {
    const version = process.env.KM_FAKE_UPDATE;
    win.webContents.once('did-finish-load', () => setTimeout(() => sendUpdate({
      state: 'available', version, current: app.getVersion(),
      notes: '<h2>Что нового</h2><ul><li>Новые зависимости модов</li><li>Окно обновления</li></ul>',
    }), 2500));
    handle('update:download', () => {
      let p = 0;
      const t = setInterval(() => {
        p += 20;
        sendUpdate({ state: 'downloading', version, percent: p });
        if (p >= 100) { clearInterval(t); sendUpdate({ state: 'ready', version }); }
      }, 400);
    });
    handle('update:install', () => {});
    return;
  }
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    // качаем только после согласия игрока (окно «Вышло обновление»)
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    let offered = null;
    autoUpdater.on('update-available', i => {
      if (offered === i.version) return;
      offered = i.version;
      const notes = Array.isArray(i.releaseNotes) ? i.releaseNotes.map(n => n.note).join('') : i.releaseNotes || '';
      sendUpdate({ state: 'available', version: i.version, current: app.getVersion(), notes: String(notes).slice(0, 20000) });
    });
    autoUpdater.on('download-progress', p => sendUpdate({ state: 'downloading', version: offered, percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', i => sendUpdate({ state: 'ready', version: i.version }));
    autoUpdater.on('error', e => { if (offered) sendUpdate({ state: 'error', version: offered, message: String(e?.message || e).slice(0, 300) }); });
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    check();
    // лаунчер могут держать открытым часами: проверяем снова каждые 3 часа
    setInterval(check, 3 * 60 * 60 * 1000);
    handle('update:download', () => autoUpdater.downloadUpdate().catch(e => {
      sendUpdate({ state: 'error', version: offered, message: String(e?.message || e).slice(0, 300) });
    }));
    // игра запущена — не закрываем её: обновление поставится, когда лаунчер закроют
    handle('update:install', () => (launcher.isRunning() ? false : (autoUpdater.quitAndInstall(false, true), true)));
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
    const sub = which.slice(9).split('/');
    dir = path.join(paths.instances, sub[0].replace(/[^a-zA-Z0-9._-]/g, '_'));
    if (sub[1] && instances.KINDS[sub[1]]) dir = path.join(dir, instances.KINDS[sub[1]]);
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

// ── Сборки (как в Prism) ─────────────────────────────────────────
handle('instances:list', () => instances.list());
handle('instances:get', id => instances.get(id));
handle('instances:create', opts => instances.create(opts || {}));
handle('instances:update', (id, patch) => instances.update(id, patch || {}));
handle('instances:remove', id => instances.remove(id));
handle('instances:duplicate', id => instances.duplicate(id));
handle('instances:content', (id, kind) => instances.content(id, kind));
handle('instances:toggle', (id, kind, file) => instances.toggle(id, kind, file));
handle('instances:removeFile', (id, kind, file) => instances.removeFile(id, kind, file));
handle('instances:addFiles', async (id, kind) => {
  const filters = {
    mods: [{ name: 'Моды', extensions: ['jar'] }],
    resourcepacks: [{ name: 'Ресурспаки', extensions: ['zip'] }],
    shaders: [{ name: 'Шейдеры', extensions: ['zip'] }],
  };
  if (!filters[kind]) throw new Error('Сюда нельзя добавить файлы');
  const r = await dialog.showOpenDialog(win, { title: 'Добавить файлы', properties: ['openFile', 'multiSelections'], filters: filters[kind] });
  if (r.canceled || !r.filePaths.length) return 0;
  instances.addFiles(id, kind, r.filePaths);
  return r.filePaths.length;
});
handle('instances:install', (id, projectId, type, source, deps) =>
  instances.installProject(id, projectId, type, p => send('content:progress', p), source === 'curseforge' ? 'curseforge' : 'modrinth',
    new Set(), Array.isArray(deps) ? deps : null));
handle('instances:plan', (id, projectId, type, source) => instances.planInstall(id, projectId, type, source === 'curseforge' ? 'curseforge' : 'modrinth'));
handle('modpack:install', ref => {
  const progress = p => send('content:progress', p);
  return ref?.source === 'curseforge' ? instances.installCfPack(ref, progress) : instances.installMrpack(ref || {}, progress);
});
handle('modpack:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Импорт сборки', properties: ['openFile'], filters: [{ name: 'Сборка Modrinth или CurseForge', extensions: ['mrpack', 'zip'] }] });
  if (r.canceled || !r.filePaths.length) return null;
  return instances.importPack(r.filePaths[0], p => send('content:progress', p));
});
handle('instances:checkUpdates', id => instances.checkUpdates(id));
handle('instances:applyUpdates', (id, list) => instances.applyUpdates(id, list, p => send('content:progress', p)));
handle('instances:backupWorld', (id, world) => instances.backupWorld(id, world));
handle('instances:export', async id => {
  const inst = instances.get(id);
  const name = inst.name.replace(/[\\/:*?"<>|]+/g, '_');
  const r = await dialog.showSaveDialog(win, {
    title: 'Сохранить сборку', defaultPath: path.join(app.getPath('desktop'), `${name}.mrpack`),
    filters: [{ name: 'Сборка Modrinth', extensions: ['mrpack'] }],
  });
  if (r.canceled || !r.filePath) return null;
  return instances.exportMrpack(id, r.filePath, p => send('content:progress', p));
});
handle('file:open', file => {
  // открываем только скриншоты и копии миров из папок сборок
  const full = path.resolve(String(file));
  const rel = path.relative(paths.instances, full).split(path.sep);
  if (rel[0] === '..' || path.isAbsolute(rel.join(path.sep)) || !['screenshots', 'backups'].includes(rel[1])) throw new Error('Нельзя открыть этот файл');
  return shell.openPath(full);
});
handle('file:show', file => {
  const full = path.resolve(String(file));
  if (path.relative(paths.instances, full).startsWith('..')) throw new Error('Нельзя открыть этот файл');
  shell.showItemInFolder(full);
});
handle('modrinth:search', opts => modrinth.search(opts || {}));
handle('curseforge:search', opts => curseforge.search(opts || {}));
handle('loaders:list', (kind, mc) => versions.loaderVersions(kind, mc));

process.on('uncaughtException', e => {
  console.error(e);
  if (win && !win.isDestroyed()) {
    dialog.showMessageBox(win, { type: 'error', title: 'KM Launcher', message: 'Внутренняя ошибка', detail: String(e?.stack || e) });
  }
});

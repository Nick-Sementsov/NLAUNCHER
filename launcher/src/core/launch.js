'use strict';
// Подготовка и запуск игры через minecraft-launcher-core
const fs = require('fs');
const path = require('path');
const child = require('child_process');
const { Client } = require('minecraft-launcher-core');
const Handler = require('minecraft-launcher-core/components/handler');
const paths = require('./paths');
const store = require('./store');
const auth = require('./auth');
const java = require('./java');
const versions = require('./versions');
const panel = require('./panel');

const isWin = process.platform === 'win32';

// MCLC запускает java.exe как консольную программу: на Windows выскакивает чёрное окно,
// а при нестандартном выводе `java -version` он падает. Чиним оба места.
// Игру запускаем через javaw.exe (без консоли) и НЕ передаём windowsHide: этот флаг
// прячет и само окно игры на версиях с LWJGL 2 (1.12.2 и старше) — процесс жив, окна нет.
Handler.prototype.checkJava = function (javaPath) {
  return new Promise(resolve => {
    child.execFile(javaPath, ['-version'], { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) return resolve({ run: false, message: error });
      const v = (stderr || '').match(/"(.*?)"/);
      this.client.emit('debug', `[MCLC]: Using Java ${v ? v[1] : '?'}`);
      resolve({ run: true });
    });
  });
};

Client.prototype.startMinecraft = function (launchArguments) {
  let exe = this.options.javaPath || 'java';
  if (isWin && /java\.exe$/i.test(exe)) {
    const javaw = exe.replace(/java\.exe$/i, 'javaw.exe');
    if (fs.existsSync(javaw)) exe = javaw;
  }
  const mc = child.spawn(exe, launchArguments, {
    cwd: this.options.overrides.cwd || this.options.root,
    detached: this.options.overrides.detached,
    windowsHide: false,
  });
  mc.stdout.on('data', d => this.emit('data', d.toString('utf-8')));
  mc.stderr.on('data', d => this.emit('data', d.toString('utf-8')));
  mc.on('error', e => { this.emit('data', String(e)); this.emit('close', 1); });
  mc.on('close', code => this.emit('close', code));
  return mc;
};

// В старых версиях (1.5.2 и др.) один и тот же архив нативных библиотек указан дважды:
// MCLC качает и распаковывает его параллельно, второй поток не находит файл и запуск падает.
// Та же логика, что в MCLC, но без дублей и последовательно.
Handler.prototype.getNatives = async function () {
  const Zip = require('adm-zip');
  const nativeDirectory = path.resolve(this.options.overrides.natives || path.join(this.options.root, 'natives', this.version.id));
  if (parseInt(this.version.id.split('.')[1]) >= 19) return this.options.overrides.cwd || this.options.root;
  if (fs.existsSync(nativeDirectory) && fs.readdirSync(nativeDirectory).length) return nativeDirectory;
  fs.mkdirSync(nativeDirectory, { recursive: true });

  const seen = new Set();
  const list = [];
  for (const lib of this.version.libraries) {
    if (!lib.downloads || !lib.downloads.classifiers || this.parseRule(lib)) continue;
    const c = lib.downloads.classifiers;
    const native = this.getOS() === 'osx' ? c['natives-osx'] || c['natives-macos'] : c[`natives-${this.getOS()}`];
    if (native && !seen.has(native.path)) { seen.add(native.path); list.push(native); }
  }
  this.client.emit('progress', { type: 'natives', task: 0, total: list.length });
  let done = 0;
  for (const native of list) {
    const name = native.path.split('/').pop();
    const file = path.join(nativeDirectory, name);
    await this.downloadAsync(native.url, nativeDirectory, name, true, 'natives');
    if (!await this.checkSum(native.sha1, file)) await this.downloadAsync(native.url, nativeDirectory, name, true, 'natives');
    try { new Zip(file).extractAllTo(nativeDirectory, true); } catch (e) { this.client.emit('debug', `[MCLC]: natives ${name}: ${e.message}`); }
    fs.rmSync(file, { force: true });
    this.client.emit('progress', { type: 'natives', task: ++done, total: list.length });
  }
  this.client.emit('debug', '[MCLC]: Downloaded and extracted natives');
  return nativeDirectory;
};

function cmp(a, b) {
  const pa = String(a).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

let running = null;

function isRunning() { return !!running; }

async function launch(target, { onProgress, onLog, onExit }) {
  if (running) throw new Error('Игра уже запущена');
  const s = store.get();
  const authorization = await auth.authorization(s.selectedAccount);

  let mcVersion = target.id;
  let custom;
  let forge;
  let gameDir;
  let joinServer = target.joinServer || null;

  if (target.kind === 'vanilla') {
    gameDir = path.join(paths.instances, 'default');
  } else if (target.kind === 'fabric') {
    onProgress({ stage: 'Ставим Fabric…', percent: 0 });
    custom = await versions.installFabric(mcVersion);
    gameDir = path.join(paths.instances, `fabric-${mcVersion}`);
  } else if (target.kind === 'server') {
    onProgress({ stage: 'Получаем сборку сервера…', percent: 0 });
    const cfg = await panel.config();
    const build = cfg.builds.find(b => b.id === target.id);
    if (!build) throw new Error('Сборка больше недоступна на сервере');
    mcVersion = build.version;
    gameDir = path.join(paths.instances, `server-${build.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    if (build.type === 'forge' && build.forgeVersion) {
      forge = await panel.ensureForgeInstaller(mcVersion, build.forgeVersion, onProgress);
    } else if (build.type === 'fabric') {
      custom = await versions.installFabric(mcVersion);
    }
    await panel.syncMods(build, gameDir, onProgress);
    if (target.joinServer !== false && cfg.settings?.serverIp) joinServer = cfg.settings.serverIp;
    if (authorization.name) panel.registerPlayer(authorization.name).catch(() => {});
  } else {
    throw new Error('Неизвестный тип версии');
  }

  const required = await versions.requiredJava(mcVersion);
  const javaPath = await java.ensureJava(required, onProgress);

  const maxMb = Math.max(1024, s.memoryMb | 0);
  const options = {
    root: paths.game,
    cache: path.join(paths.cache, 'mclc'),
    javaPath,
    authorization,
    version: { number: mcVersion, type: versions.versionType(mcVersion), ...(custom ? { custom } : {}) },
    ...(forge ? { forge } : {}),
    memory: { max: `${maxMb}M`, min: `${Math.min(1024, maxMb)}M` },
    window: s.resolution.fullscreen
      ? { fullscreen: true }
      : { width: String(s.resolution.width), height: String(s.resolution.height) },
    customArgs: s.jvmArgs ? s.jvmArgs.split(/\s+/).filter(Boolean) : undefined,
    // cwd = папка инстанса: туда MCLC кладёт log4j-конфиг (защита от Log4Shell для 1.7–1.16),
    // и игра должна стартовать оттуда же, иначе относительный путь к конфигу не найдётся
    overrides: { gameDirectory: gameDir, cwd: gameDir, detached: false, maxSockets: 8 },
    timeout: 60000,
  };

  if (joinServer) {
    if (cmp(mcVersion, '1.20') >= 0) {
      options.quickPlay = { type: 'multiplayer', identifier: joinServer };
    } else {
      const [host, port] = joinServer.split(':');
      options.customLaunchArgs = ['--server', host, '--port', port || '25565'];
    }
  }

  fs.mkdirSync(gameDir, { recursive: true });
  const logFile = fs.createWriteStream(path.join(paths.logs, 'latest.log'));
  const tail = [];
  const client = new Client();
  running = client;
  let started = false;

  client.on('progress', p => {
    const names = { assets: 'Ресурсы игры', natives: 'Нативные библиотеки', classes: 'Библиотеки',
      'classes-custom': 'Библиотеки загрузчика', 'classes-maven-custom': 'Библиотеки загрузчика',
      'assets-copy': 'Копируем ресурсы', forge: 'Forge' };
    onProgress({ stage: `Загрузка: ${names[p.type] || p.type}`, percent: p.total ? Math.round(p.task / p.total * 100) : 0 });
  });
  client.on('download-status', d => {
    if (d.type === 'version-jar') {
      onProgress({ stage: 'Загрузка: файл игры', percent: d.total ? Math.round(d.current / d.total * 100) : 0 });
    }
  });
  client.on('debug', line => { logFile.write(line + '\n'); onLog(line + '\n'); });
  client.on('arguments', () => onProgress({ stage: 'Запускаем игру…', percent: 100 }));
  client.on('data', line => {
    if (!started) { started = true; onProgress({ stage: 'Игра запущена', percent: 100, started: true }); }
    logFile.write(line);
    onLog(line);
    tail.push(line);
    if (tail.length > 60) tail.shift();
  });
  client.on('close', code => {
    running = null;
    logFile.end();
    onExit({ code, crashed: code !== 0 && code !== null, tail: tail.join('').slice(-6000) });
  });

  const proc = await client.launch(options);
  if (proc && running === client) client.proc = proc;
  if (!proc && running) {
    running = null;
    throw new Error('Не удалось запустить игру. Подробности в консоли');
  }
}

// Принудительно закрыть игру (например, если она зависла)
function stop() {
  const proc = running && running.proc;
  if (!proc || proc.exitCode !== null) return false;
  if (isWin) child.execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else proc.kill('SIGKILL');
  return true;
}

module.exports = { launch, isRunning, stop };

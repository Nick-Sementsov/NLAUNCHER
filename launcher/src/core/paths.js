'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');

// Все файлы игры живут в %APPDATA%\.kmlauncher (на Windows), чтобы не трогать обычный .minecraft
function baseDir() {
  const appData = process.env.APPDATA
    || (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.local', 'share'));
  return path.join(appData, '.kmlauncher');
}

const ROOT = baseDir();
const paths = {
  root: ROOT,
  game: path.join(ROOT, 'game'),
  instances: path.join(ROOT, 'instances'),
  runtime: path.join(ROOT, 'runtime'),
  cache: path.join(ROOT, 'cache'),
  config: path.join(ROOT, 'launcher.json'),
  logs: path.join(ROOT, 'logs'),
};

for (const p of [paths.root, paths.game, paths.instances, paths.runtime, paths.cache, paths.logs]) {
  fs.mkdirSync(p, { recursive: true });
}

module.exports = paths;

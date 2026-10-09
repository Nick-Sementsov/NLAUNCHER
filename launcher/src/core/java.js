'use strict';
// Автоматическая установка Java (Eclipse Temurin JRE от Adoptium) под нужную версию игры.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { getJson, download } = require('./net');
const paths = require('./paths');

const LTS = [8, 17, 21, 25];
const isWin = process.platform === 'win32';

function pickFeature(required) {
  return LTS.find(v => v >= required) || LTS[LTS.length - 1];
}

function osName() {
  return isWin ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
}

function archName() {
  return process.arch === 'arm64' ? 'aarch64' : 'x64';
}

function findJava(dir) {
  const exe = isWin ? 'java.exe' : 'java';
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === exe && path.basename(cur) === 'bin') return full;
    }
  }
  return null;
}

// Возвращает путь к java(.exe), при необходимости скачивая её
async function ensureJava(required, onProgress) {
  const feature = pickFeature(required || 8);
  const dir = path.join(paths.runtime, `java-${feature}`);
  const existing = fs.existsSync(dir) && findJava(dir);
  if (existing) return existing;

  onProgress?.({ stage: `Ищем Java ${feature}…`, percent: 0 });
  const url = `https://api.adoptium.net/v3/assets/latest/${feature}/hotspot?architecture=${archName()}&image_type=jre&os=${osName()}&vendor=eclipse`;
  const assets = await getJson(url);
  const pkg = assets?.[0]?.binary?.package;
  if (!pkg?.link) throw new Error(`Не удалось найти Java ${feature} для этой системы`);

  const archive = path.join(paths.cache, pkg.name);
  await download(pkg.link, archive, (done, total) => {
    onProgress?.({ stage: `Скачиваем Java ${feature}`, percent: total ? Math.round(done / total * 100) : 0 });
  });

  onProgress?.({ stage: `Распаковываем Java ${feature}…`, percent: 100 });
  const tmp = dir + '.tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  if (pkg.name.endsWith('.zip')) {
    new AdmZip(archive).extractAllTo(tmp, true);
  } else {
    // tar.gz для Linux/macOS
    const { execFileSync } = require('child_process');
    execFileSync('tar', ['-xzf', archive, '-C', tmp]);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  fs.rmSync(archive, { force: true });

  const java = findJava(dir);
  if (!java) throw new Error('Java скачана, но java.exe не найдена');
  if (!isWin) fs.chmodSync(java, 0o755);
  return java;
}

module.exports = { ensureJava, pickFeature };

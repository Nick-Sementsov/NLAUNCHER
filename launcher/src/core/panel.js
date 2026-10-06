'use strict';
// Связь с панелью управления (server.js в корне репозитория): новости и серверные сборки с модами
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getJson, download } = require('./net');
const store = require('./store');
const paths = require('./paths');

function base() {
  return (store.get().panelUrl || '').replace(/\/+$/, '');
}

async function config() {
  if (!base()) return { settings: {}, builds: [] };
  return getJson(`${base()}/api/launcher/config`, { timeout: 8000 });
}

async function news() {
  if (!base()) return [];
  return getJson(`${base()}/api/launcher/news`, { timeout: 8000 });
}

async function registerPlayer(nickname) {
  if (!base()) return;
  const https = require(base().startsWith('https') ? 'https' : 'http');
  const body = JSON.stringify({ nickname });
  await new Promise(resolve => {
    const req = https.request(`${base()}/api/launcher/player`, {
      method: 'POST', timeout: 5000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.resume(); resolve(); });
    req.on('error', resolve);
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.end(body);
  });
}

function sha512(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('hex');
}

// Синхронизирует моды сборки в папку инстанса. Удаляет только те моды, что ставил сам лаунчер.
async function syncMods(build, gameDir, onProgress) {
  const modsDir = path.join(gameDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const stateFile = path.join(gameDir, '.km-mods.json');
  let previous = [];
  try { previous = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* первый запуск */ }

  const wanted = (build.mods || []).map(m => ({ ...m, local: m.name.replace(/[^a-zA-Z0-9._+-]/g, '_') }));
  const wantedNames = new Set(wanted.map(m => m.local));
  for (const old of previous) {
    if (!wantedNames.has(old)) fs.rmSync(path.join(modsDir, old), { force: true });
  }

  let i = 0;
  for (const mod of wanted) {
    i++;
    const dest = path.join(modsDir, mod.local);
    const ok = fs.existsSync(dest)
      && (mod.sha512 ? sha512(dest) === mod.sha512 : fs.statSync(dest).size === mod.size);
    if (!ok) {
      onProgress?.({ stage: `Моды сборки: ${mod.name}`, percent: Math.round((i - 1) / wanted.length * 100) });
      await download(mod.url, dest);
    }
  }
  fs.writeFileSync(stateFile, JSON.stringify([...wantedNames]));
}

function forgeInstallerUrl(mc, forge) {
  const v = `${mc}-${forge}`;
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${v}/forge-${v}-installer.jar`;
}

async function ensureForgeInstaller(mc, forge, onProgress) {
  const file = path.join(paths.cache, 'forge', `forge-${mc}-${forge}-installer.jar`);
  if (!fs.existsSync(file)) {
    await download(forgeInstallerUrl(mc, forge), file, (d, t) =>
      onProgress?.({ stage: 'Скачиваем Forge', percent: t ? Math.round(d / t * 100) : 0 }));
  }
  return file;
}

module.exports = { config, news, registerPlayer, syncMods, ensureForgeInstaller };

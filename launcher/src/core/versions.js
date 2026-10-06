'use strict';
// Список версий: официальный манифест Mojang + загрузчик Fabric
const fs = require('fs');
const path = require('path');
const { getJson } = require('./net');
const paths = require('./paths');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC = 'https://meta.fabricmc.net/v2';

let manifestCache = null;

async function manifest() {
  if (manifestCache) return manifestCache;
  const file = path.join(paths.cache, 'version_manifest_v2.json');
  try {
    manifestCache = await getJson(MANIFEST);
    fs.writeFileSync(file, JSON.stringify(manifestCache));
  } catch (e) {
    // без интернета показываем последний сохранённый список
    if (fs.existsSync(file)) manifestCache = JSON.parse(fs.readFileSync(file, 'utf8'));
    else throw e;
  }
  return manifestCache;
}

async function list(showSnapshots) {
  const m = await manifest();
  return {
    latest: m.latest,
    versions: m.versions
      .filter(v => v.type === 'release' || (showSnapshots && v.type === 'snapshot'))
      .map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })),
  };
}

// Требуемая версия Java для версии игры (из официального JSON версии)
async function requiredJava(mcVersion) {
  const m = await manifest();
  const entry = m.versions.find(v => v.id === mcVersion);
  if (!entry) return 8;
  const file = path.join(paths.cache, 'versions', `${mcVersion}.json`);
  let json;
  if (fs.existsSync(file)) {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    json = await getJson(entry.url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json));
  }
  return json.javaVersion?.majorVersion || 8;
}

function versionType(mcVersion) {
  return manifestCache?.versions.find(v => v.id === mcVersion)?.type || 'release';
}

async function fabricGameVersions() {
  const list = await getJson(`${FABRIC}/versions/game`);
  return new Set(list.map(v => v.version));
}

// Ставит профиль Fabric в versions/ и возвращает его имя для MCLC (version.custom)
async function installFabric(mcVersion) {
  const loaders = await getJson(`${FABRIC}/versions/loader/${encodeURIComponent(mcVersion)}`);
  const stable = loaders.find(l => l.loader.stable) || loaders[0];
  if (!stable) throw new Error(`Fabric пока не поддерживает ${mcVersion}`);
  const loader = stable.loader.version;
  const id = `fabric-loader-${loader}-${mcVersion}`;
  const dir = path.join(paths.game, 'versions', id);
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) {
    const profile = await getJson(`${FABRIC}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loader)}/profile/json`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(profile, null, 2));
  }
  return id;
}

module.exports = { list, requiredJava, versionType, fabricGameVersions, installFabric };

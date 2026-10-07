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

const QUILT = 'https://meta.quiltmc.org/v3';
const FORGE_META = 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json';

// Профиль Fabric/Quilt кладём в versions/ и возвращаем его имя для MCLC (version.custom)
async function installLoaderProfile(kind, mcVersion, loaderVersion) {
  const base = kind === 'quilt' ? QUILT : FABRIC;
  const name = kind === 'quilt' ? 'Quilt' : 'Fabric';
  let loader = loaderVersion;
  if (!loader) {
    const loaders = await getJson(`${base}/versions/loader/${encodeURIComponent(mcVersion)}`);
    const pick = kind === 'quilt'
      ? loaders.find(l => !/beta|pre/i.test(l.loader.version)) || loaders[0]
      : loaders.find(l => l.loader.stable) || loaders[0];
    if (!pick) throw new Error(`${name} пока не поддерживает ${mcVersion}`);
    loader = pick.loader.version;
  }
  const id = `${kind}-loader-${loader}-${mcVersion}`;
  const dir = path.join(paths.game, 'versions', id);
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) {
    const profile = await getJson(`${base}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loader)}/profile/json`);
    profile.id = id;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(profile, null, 2));
  }
  return id;
}

function installFabric(mcVersion, loaderVersion) {
  return installLoaderProfile('fabric', mcVersion, loaderVersion);
}

function installQuilt(mcVersion, loaderVersion) {
  return installLoaderProfile('quilt', mcVersion, loaderVersion);
}

// Версии загрузчика для выбранной версии игры (для окна создания сборки)
async function loaderVersions(kind, mcVersion) {
  if (kind === 'fabric' || kind === 'quilt') {
    const base = kind === 'quilt' ? QUILT : FABRIC;
    const list = await getJson(`${base}/versions/loader/${encodeURIComponent(mcVersion)}`);
    return list.map(l => ({ id: l.loader.version, stable: kind === 'quilt' ? !/beta|pre/i.test(l.loader.version) : !!l.loader.stable }));
  }
  if (kind === 'forge') {
    const meta = await getJson(FORGE_META);
    const num = v => v.split(/[.-]/).map(n => parseInt(n, 10) || 0);
    const desc = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); } return 0; };
    return (meta[mcVersion] || []).map(v => v.slice(mcVersion.length + 1)).sort(desc).map(id => ({ id, stable: true }));
  }
  return [];
}

module.exports = { list, requiredJava, versionType, fabricGameVersions, installFabric, installQuilt, loaderVersions };

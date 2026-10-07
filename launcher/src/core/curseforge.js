'use strict';
// Каталог CurseForge: моды, ресурспаки, шейдеры и сборки.
// Официальному API нужен ключ. Если ключа нет (KM_CF_API_KEY не задан при сборке),
// идём через открытое зеркало api.curse.tools — оно отдаёт те же ответы без ключа.
const { getJson } = require('./net');

let KEY = process.env.KM_CF_API_KEY || '';
try { KEY = KEY || require('./cf-key.json').key || ''; } catch { /* ключа нет */ }
const API = KEY ? 'https://api.curseforge.com/v1' : 'https://api.curse.tools/v1/cf';
const headers = KEY ? { 'x-api-key': KEY } : {};

const GAME = 432; // Minecraft
const CLASS = { mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 };
const LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const SORT = { relevance: 1, downloads: 6, follows: 2, newest: 11, updated: 3 };

const get = path => getJson(`${API}${path}`, { timeout: 20000, headers });

function q(obj) {
  return Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

async function search({ query = '', type = 'mod', mc, loader, offset = 0, limit = 20, index = 'relevance' }) {
  const params = {
    gameId: GAME, classId: CLASS[type], searchFilter: query, gameVersion: mc,
    sortField: SORT[index] || 2, sortOrder: 'desc', index: offset, pageSize: limit,
  };
  // Quilt запускает моды Fabric: для Quilt-сборки ищем моды Fabric
  if (type === 'mod' && LOADER[loader]) params.modLoaderType = loader === 'quilt' ? LOADER.fabric : LOADER[loader];
  const res = await get(`/mods/search?${q(params)}`);
  return {
    total: Math.min(res.pagination?.totalCount || 0, 10000 - limit), // API не даёт листать дальше 10000
    hits: (res.data || []).map(m => ({
      id: String(m.id), slug: m.slug, title: m.name, description: m.summary,
      icon: m.logo?.thumbnailUrl || '', author: m.authors?.[0]?.name || '', downloads: m.downloadCount,
      type, categories: (m.categories || []).map(c => c.name), source: 'curseforge',
    })),
  };
}

// Зеркало без ключа отвечает 403 на /files с фильтрами и не умеет POST,
// поэтому берём только простые GET-запросы и фильтруем сами.
const projCache = new Map();
async function project(id) {
  id = String(id);
  if (!projCache.has(id)) projCache.set(id, get(`/mods/${encodeURIComponent(id)}`).then(r => r.data).catch(e => { projCache.delete(id); throw e; }));
  return projCache.get(id);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const projects = ids => pool([...new Set(ids.map(String))], 8, id => project(id).catch(() => null)).then(l => l.filter(Boolean));

async function file(modId, fileId) {
  return (await get(`/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`)).data;
}

// Файлы по списку {projectID, fileID} из manifest.json
const filesByRef = refs => pool(refs, 8, r => file(r.projectID, r.fileID));

const LOADER_NAME = { forge: 'Forge', fabric: 'Fabric', quilt: 'Quilt' };

// Подходящие файлы проекта: сначала стабильные, потом новые
async function files(id, { mc, loader, type } = {}) {
  const loaders = type === 'mod' && LOADER[loader] ? (loader === 'quilt' ? ['quilt', 'fabric'] : [loader]) : null;
  const order = (a, b) => (a.releaseType - b.releaseType) || ((b.fileId || b.id) - (a.fileId || a.id));
  // 1) индекс последних файлов в карточке проекта — без лишних запросов
  const proj = await project(id);
  const idx = (proj.latestFilesIndexes || [])
    .filter(x => (!mc || x.gameVersion === mc) && (!loaders || loaders.some(l => x.modLoader === LOADER[l])))
    .sort(order);
  if (idx.length) {
    const f = await file(id, idx[0].fileId);
    if (f && f.isAvailable !== false) return [f];
  }
  // 2) запасной путь: последние файлы проекта, фильтруем по версии и загрузчику сами
  const res = await get(`/mods/${encodeURIComponent(id)}/files`);
  return (res.data || [])
    .filter(f => f.isAvailable !== false)
    .filter(f => !mc || (f.gameVersions || []).includes(mc))
    .filter(f => !loaders || loaders.some(l => (f.gameVersions || []).includes(LOADER_NAME[l])))
    .sort(order);
}

function sha1Of(f) { return (f.hashes || []).find(h => h.algo === 1)?.value || ''; }

// Ссылка на страницу проекта (для модов, которые автор запретил качать сторонним программам)
function pageUrl(m, kind = 'mc-mods') {
  return m?.links?.websiteUrl || `https://www.curseforge.com/minecraft/${kind}/${m?.slug || ''}`;
}

module.exports = { search, project, projects, files, filesByRef, sha1Of, pageUrl, CLASS, usesMirror: !KEY };

'use strict';
// Каталог CurseForge: моды, ресурспаки, шейдеры и сборки.
// Официальному API нужен ключ. Если ключа нет (KM_CF_API_KEY не задан при сборке),
// идём через открытое зеркало api.curse.tools — оно отдаёт те же ответы без ключа.
const { getJson, postJson } = require('./net');

let KEY = process.env.KM_CF_API_KEY || '';
try { KEY = KEY || require('./cf-key.json').key || ''; } catch { /* ключа нет */ }
const API = KEY ? 'https://api.curseforge.com' : 'https://api.curse.tools/v1/cf';
const headers = KEY ? { 'x-api-key': KEY } : {};

const GAME = 432; // Minecraft
const CLASS = { mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 };
const LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const SORT = { relevance: 1, downloads: 6, follows: 2, newest: 11, updated: 3 };

const get = path => getJson(`${API}${path}`, { timeout: 20000, headers });
const post = (path, body) => postJson(`${API}${path}`, body, { timeout: 30000, headers });

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
  const res = await get(`/v1/mods/search?${q(params)}`);
  return {
    total: Math.min(res.pagination?.totalCount || 0, 10000 - limit), // API не даёт листать дальше 10000
    hits: (res.data || []).map(m => ({
      id: String(m.id), slug: m.slug, title: m.name, description: m.summary,
      icon: m.logo?.thumbnailUrl || '', author: m.authors?.[0]?.name || '', downloads: m.downloadCount,
      type, categories: (m.categories || []).map(c => c.name), source: 'curseforge',
    })),
  };
}

async function project(id) { return (await get(`/v1/mods/${encodeURIComponent(id)}`)).data; }

async function projects(ids) {
  if (!ids.length) return [];
  return (await post('/v1/mods', { modIds: ids.map(Number) })).data || [];
}

// Подходящие файлы проекта, новые первыми
async function files(id, { mc, loader, type } = {}) {
  const params = { gameVersion: mc, pageSize: 50 };
  if (type === 'mod' && LOADER[loader]) params.modLoaderType = loader === 'quilt' ? LOADER.fabric : LOADER[loader];
  const res = await get(`/v1/mods/${encodeURIComponent(id)}/files?${q(params)}`);
  let list = (res.data || []).filter(f => f.isAvailable !== false);
  // releaseType: 1 релиз, 2 бета, 3 альфа — сначала стабильные
  list.sort((a, b) => (a.releaseType - b.releaseType) || (new Date(b.fileDate) - new Date(a.fileDate)));
  return list;
}

async function filesById(ids) {
  if (!ids.length) return [];
  return (await post('/v1/mods/files', { fileIds: ids.map(Number) })).data || [];
}

function sha1Of(f) { return (f.hashes || []).find(h => h.algo === 1)?.value || ''; }

// Ссылка на страницу проекта (для модов, которые автор запретил качать сторонним программам)
function pageUrl(m, kind = 'mc-mods') {
  return m?.links?.websiteUrl || `https://www.curseforge.com/minecraft/${kind}/${m?.slug || ''}`;
}

module.exports = { search, project, projects, files, filesById, sha1Of, pageUrl, CLASS, usesMirror: !KEY };

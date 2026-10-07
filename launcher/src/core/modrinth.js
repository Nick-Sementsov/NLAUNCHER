'use strict';
// Каталог Modrinth: поиск модов, ресурспаков, шейдеров и сборок
const { getJson } = require('./net');

const API = 'https://api.modrinth.com/v2';

// Как называются загрузчики в Modrinth
const LOADER_TAG = { fabric: 'fabric', quilt: 'quilt', forge: 'forge', neoforge: 'neoforge' };

function q(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`)
    .join('&');
}

// type: mod | resourcepack | shader | modpack
async function search({ query = '', type = 'mod', mc, loader, offset = 0, limit = 20, index = 'relevance' }) {
  const facets = [[`project_type:${type}`]];
  if (mc) facets.push([`versions:${mc}`]);
  // у модов фильтруем по загрузчику; Quilt умеет запускать моды Fabric
  if (type === 'mod' && LOADER_TAG[loader]) {
    facets.push(loader === 'quilt' ? ['categories:quilt', 'categories:fabric'] : [`categories:${LOADER_TAG[loader]}`]);
  }
  const res = await getJson(`${API}/search?${q({ query, facets, offset, limit, index })}`, { timeout: 15000 });
  return {
    total: res.total_hits,
    hits: res.hits.map(h => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description,
      icon: h.icon_url || '', author: h.author, downloads: h.downloads, type: h.project_type,
      categories: h.categories || [],
    })),
  };
}

function project(id) {
  return getJson(`${API}/project/${encodeURIComponent(id)}`, { timeout: 15000 });
}

// Подходящие версии проекта (новые первыми)
async function versions(id, { mc, loader, type } = {}) {
  const params = {};
  if (mc) params.game_versions = [mc];
  if (type === 'mod' && LOADER_TAG[loader]) params.loaders = loader === 'quilt' ? ['quilt', 'fabric'] : [LOADER_TAG[loader]];
  return getJson(`${API}/project/${encodeURIComponent(id)}/version?${q(params)}`, { timeout: 15000 });
}

function version(id) {
  return getJson(`${API}/version/${encodeURIComponent(id)}`, { timeout: 15000 });
}

function primaryFile(v) {
  return v.files.find(f => f.primary) || v.files[0];
}

module.exports = { search, project, versions, version, primaryFile };

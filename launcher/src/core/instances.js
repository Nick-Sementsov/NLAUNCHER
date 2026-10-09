'use strict';
// Сборки (инстансы), как в Prism: у каждой своя папка, версия игры, загрузчик, моды и ресурспаки
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const { download } = require('./net');
const versions = require('./versions');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');

const META = 'instance.json';
const KINDS = { mods: 'mods', resourcepacks: 'resourcepacks', shaders: 'shaderpacks', saves: 'saves', screenshots: 'screenshots' };
const TYPE_DIR = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge'];

function dir(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Неверная сборка');
  return path.join(paths.instances, id);
}

function readMeta(id) {
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir(id), META), 'utf8')); } catch { return null; }
  // 1.5.0 запоминал версию загрузчика, подобранную автоматически, и сборка застревала на ней.
  // Теперь пустая версия = «рекомендуемая», а закреплённая — только выбранная вручную или из модпака.
  if (!('loaderPinned' in meta)) {
    meta.loaderPinned = !!meta.source && !!meta.loaderVersion;
    if (!meta.loaderPinned) meta.loaderVersion = '';
  }
  return meta;
}

function writeMeta(id, meta) {
  const file = path.join(dir(id), META);
  fs.writeFileSync(file + '.tmp', JSON.stringify(meta, null, 2));
  fs.renameSync(file + '.tmp', file);
}

function slug(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'sborka';
  let id = base;
  for (let i = 2; fs.existsSync(path.join(paths.instances, id)); i++) id = `${base}-${i}`;
  return id;
}

function countFiles(d, re) {
  try { return fs.readdirSync(d).filter(f => re.test(f)).length; } catch { return 0; }
}

function summary(id, meta) {
  const d = dir(id);
  return {
    id, name: meta.name, mc: meta.mc, loader: meta.loader, loaderVersion: meta.loaderVersion || '',
    loaderResolved: meta.loaderVersion || meta.loaderResolved || '',
    icon: meta.icon || '', created: meta.created, lastPlayed: meta.lastPlayed || null,
    memoryMb: meta.memoryMb || 0, source: meta.source || null, server: meta.server || '',
    mods: countFiles(path.join(d, 'mods'), /\.jar$/i),
    blocked: (meta.blocked || []).filter(b => !fs.existsSync(path.join(d, b.folder, b.fileName))),
  };
}

function list() {
  const out = [];
  for (const id of fs.readdirSync(paths.instances)) {
    if (!/^[a-z0-9-]+$/.test(id)) continue;
    const meta = readMeta(id);
    if (meta) out.push(summary(id, meta));
  }
  return out.sort((a, b) => (b.lastPlayed || b.created || '').localeCompare(a.lastPlayed || a.created || ''));
}

function get(id) {
  const meta = readMeta(id);
  if (!meta) throw new Error('Сборка не найдена');
  return summary(id, meta);
}

function create({ name, mc, loader = 'vanilla', loaderVersion = '', icon = '', source = null }) {
  name = String(name || '').trim().slice(0, 40);
  if (!name) throw new Error('Придумай название сборки');
  if (!mc) throw new Error('Выбери версию игры');
  if (!LOADERS.includes(loader)) throw new Error('Неизвестный загрузчик');
  const id = slug(name);
  fs.mkdirSync(path.join(dir(id), 'mods'), { recursive: true });
  writeMeta(id, { name, mc, loader, loaderVersion, loaderPinned: !!loaderVersion, icon, source, created: new Date().toISOString(), files: {} });
  return get(id);
}

function update(id, patch) {
  const meta = readMeta(id);
  if (!meta) throw new Error('Сборка не найдена');
  const allowed = ['name', 'mc', 'loader', 'loaderVersion', 'loaderResolved', 'memoryMb', 'lastPlayed', 'icon', 'server'];
  if ('server' in patch) patch = { ...patch, server: cleanServer(patch.server) };
  if ('loader' in patch && patch.loader !== meta.loader && !('loaderVersion' in patch)) patch = { ...patch, loaderVersion: '' };
  for (const k of allowed) if (k in patch) meta[k] = patch[k];
  if ('loaderVersion' in patch) { meta.loaderPinned = !!patch.loaderVersion; meta.loaderResolved = ''; }
  if (!String(meta.name || '').trim()) throw new Error('Название не может быть пустым');
  if (!LOADERS.includes(meta.loader)) throw new Error('Неизвестный загрузчик');
  writeMeta(id, meta);
  return get(id);
}

// Адрес сервера для автовхода: «play.example.com» или «1.2.3.4:25566»
function cleanServer(v) {
  v = String(v || '').trim().replace(/^minecraft:\/\//i, '');
  if (!v) return '';
  if (!/^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(v)) throw new Error('Адрес сервера выглядит неправильно. Пример: play.example.com или 1.2.3.4:25565');
  return v;
}

function remove(id) {
  if (!readMeta(id)) throw new Error('Сборка не найдена');
  fs.rmSync(dir(id), { recursive: true, force: true });
}

function duplicate(id) {
  const meta = readMeta(id);
  if (!meta) throw new Error('Сборка не найдена');
  const copy = create({ ...meta, name: `${meta.name} (копия)` });
  fs.cpSync(dir(id), dir(copy.id), { recursive: true, filter: src => path.basename(src) !== META });
  writeMeta(copy.id, { ...meta, name: copy.name, created: new Date().toISOString(), lastPlayed: null });
  return get(copy.id);
}

// ── Содержимое: моды, ресурспаки, шейдеры, миры ──────────────────
function readModInfo(file) {
  try {
    const zip = new AdmZip(file);
    const text = n => { const e = zip.getEntry(n); return e ? e.getData().toString('utf8') : null; };
    const fab = text('fabric.mod.json');
    if (fab) { const j = JSON.parse(fab.replace(/[\u0000-\u001f]+/g, ' ')); return { name: j.name || j.id, version: j.version }; }
    const quilt = text('quilt.mod.json');
    if (quilt) { const j = JSON.parse(quilt).quilt_loader || {}; return { name: j.metadata?.name || j.id, version: j.version }; }
    const toml = text('META-INF/mods.toml') || text('META-INF/neoforge.mods.toml');
    if (toml) {
      const name = toml.match(/displayName\s*=\s*"([^"]+)"/)?.[1];
      const ver = toml.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
      return { name, version: ver && !ver.includes('$') ? ver : '' };
    }
    const info = text('mcmod.info');
    if (info) { const j = JSON.parse(info); const m = Array.isArray(j) ? j[0] : j.modList?.[0]; return { name: m?.name, version: m?.version }; }
  } catch { /* не архив или битый файл */ }
  return {};
}

function content(id, kind) {
  const meta = readMeta(id);
  if (!meta || !KINDS[kind]) throw new Error('Неизвестный раздел');
  const d = path.join(dir(id), KINDS[kind]);
  fs.mkdirSync(d, { recursive: true });
  const cacheFile = path.join(dir(id), '.km-modcache.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* пусто */ }
  const items = [];
  for (const f of fs.readdirSync(d)) {
    const full = path.join(d, f);
    const st = fs.statSync(full);
    if (kind === 'saves') {
      if (st.isDirectory()) items.push({ file: f, name: f, enabled: true, size: 0, mtime: st.mtimeMs });
      continue;
    }
    if (kind === 'screenshots') {
      if (/\.png$/i.test(f)) items.push({ file: f, name: f, enabled: true, size: st.size, mtime: st.mtimeMs, path: full });
      continue;
    }
    const enabled = !/\.disabled$/i.test(f);
    const base = f.replace(/\.disabled$/i, '');
    if (kind === 'mods' && !/\.jar$/i.test(base)) continue;
    if (kind !== 'mods' && !st.isDirectory() && !/\.zip$/i.test(base)) continue;
    const known = meta.files?.[`${KINDS[kind]}/${base}`];
    let info = {};
    if (kind === 'mods') {
      const key = `${base}:${st.size}:${Math.round(st.mtimeMs)}`;
      info = cache[key] || (cache[key] = readModInfo(full));
    }
    items.push({
      file: f, enabled, size: st.size,
      name: known?.title || info.name || base.replace(/\.(jar|zip)$/i, ''),
      version: known?.version || info.version || '',
      icon: known?.icon || '', projectId: known?.projectId || '',
    });
  }
  if (kind === 'mods') try { fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch { /* не страшно */ }
  if (kind === 'screenshots' || kind === 'saves') return items.sort((a, b) => b.mtime - a.mtime);
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function safeFile(id, kind, file) {
  const d = path.join(dir(id), KINDS[kind] || '');
  const full = path.resolve(d, file);
  if (!KINDS[kind] || path.dirname(full) !== path.resolve(d)) throw new Error('Неверный файл');
  return full;
}

function toggle(id, kind, file) {
  const full = safeFile(id, kind, file);
  const target = /\.disabled$/i.test(full) ? full.replace(/\.disabled$/i, '') : full + '.disabled';
  fs.renameSync(full, target);
}

function removeFile(id, kind, file) {
  const full = safeFile(id, kind, file);
  fs.rmSync(full, { recursive: true, force: true });
  const meta = readMeta(id);
  if (meta?.files) { delete meta.files[`${KINDS[kind]}/${file.replace(/\.disabled$/i, '')}`]; writeMeta(id, meta); }
}

function addFiles(id, kind, files) {
  const d = path.join(dir(id), KINDS[kind]);
  fs.mkdirSync(d, { recursive: true });
  for (const f of files) fs.copyFileSync(f, path.join(d, path.basename(f)));
}

// ── Установка с Modrinth и CurseForge ─────────────────────────────────────────
function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

// Что и откуда качать: одинаковый вид для Modrinth и CurseForge
async function resolveProject(source, projectId, meta, type, loader) {
  const want = `${meta.mc}${loader && type === 'mod' ? ' ' + loader : ''}`;
  if (source === 'curseforge') {
    const [proj, list] = await Promise.all([
      curseforge.project(projectId),
      curseforge.files(projectId, { mc: meta.mc, loader, type }).catch(() => null),
    ]);
    const f = list?.[0];
    if (!f && list) throw new Error(`«${proj.name}» нет для ${want}`);
    if (!f || !f.downloadUrl) {
      const twin = await modrinthTwin(proj, meta.mc, loader, TYPE_DIR[type]);
      if (twin) return { ...twin, deps: [], source: 'modrinth' };
      throw new Error(`CurseForge не отдаёт «${proj.name}» лаунчерам (так решил автор). Скачай ${f ? 'файл ' + f.fileName : 'мод'} с сайта ${curseforge.pageUrl(proj)} и добавь кнопкой «Добавить файл».`);
    }
    return {
      id: String(proj.id), title: proj.name, icon: proj.logo?.thumbnailUrl || '',
      url: f.downloadUrl, fileName: f.fileName, sha1: curseforge.sha1Of(f), versionId: String(f.id), version: f.displayName,
      deps: (f.dependencies || []).filter(d => d.relationType === 3).map(d => String(d.modId)),
    };
  }
  const [proj, vers] = await Promise.all([
    modrinth.project(projectId),
    modrinth.versions(projectId, { mc: meta.mc, loader, type }),
  ]);
  const v = vers[0];
  if (!v) throw new Error(`«${proj.title}» нет для ${want}`);
  const file = modrinth.primaryFile(v);
  return {
    id: proj.id, title: proj.title, icon: proj.icon_url || '',
    url: file.url, fileName: file.filename, sha1: file.hashes?.sha1, versionId: v.id, version: v.version_number,
    deps: (v.dependencies || []).filter(d => d.dependency_type === 'required' && d.project_id).map(d => d.project_id),
  };
}

async function installProject(id, projectId, type, onProgress, source = 'modrinth', seen = new Set()) {
  const meta = readMeta(id);
  if (!meta) throw new Error('Сборка не найдена');
  projectId = String(projectId);
  if (seen.has(projectId)) return;
  seen.add(projectId);
  const folder = TYPE_DIR[type];
  if (!folder) throw new Error('Этот тип нельзя добавить в сборку');
  const loader = meta.loader === 'vanilla' ? null : meta.loader;
  if (type === 'mod' && !loader) throw new Error('В ванильную сборку нельзя ставить моды: создай сборку с Fabric, Quilt или Forge');

  const p = await resolveProject(source, projectId, meta, type, loader);
  // уже стоит этот проект: заменяем старый файл
  for (const [rel, info] of Object.entries(meta.files || {})) {
    if (info.projectId === p.id && rel.startsWith(folder + '/')) {
      for (const f of [rel, rel + '.disabled']) fs.rmSync(path.join(dir(id), f), { force: true });
      delete meta.files[rel];
    }
  }
  onProgress?.({ stage: `Скачиваем ${p.title}`, percent: 0 });
  const name = path.basename(p.fileName);
  const dest = path.join(dir(id), folder, name);
  await download(p.url, dest, (d, t) => onProgress?.({ stage: `Скачиваем ${p.title}`, percent: t ? Math.round(d / t * 100) : 0 }));
  if (p.sha1 && sha1(dest) !== p.sha1) { fs.rmSync(dest, { force: true }); throw new Error(`Файл ${name} скачался с ошибкой`); }
  meta.files = meta.files || {};
  meta.files[`${folder}/${name}`] = { projectId: p.id, versionId: p.versionId, title: p.title, icon: p.icon, version: p.version, source: p.source || source };
  writeMeta(id, meta);

  // обязательные зависимости (например, Fabric API)
  if (type === 'mod') {
    const installed = new Set(Object.values(readMeta(id).files || {}).map(f => f.projectId));
    for (const dep of p.deps) {
      if (installed.has(dep)) continue;
      await installProject(id, dep, 'mod', onProgress, source, seen);
    }
  }
  return { title: p.title };
}

// ── Готовые сборки (.mrpack) ─────────────────────────────────────
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

function insideDir(root, rel) {
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error('Сборка содержит недопустимый путь: ' + rel);
  return full;
}

async function installMrpack({ versionId, file, projectId }, onProgress) {
  let packFile = file;
  let source = null;
  let icon = '';
  if (versionId || projectId) {
    const v = versionId ? await modrinth.version(versionId) : (await modrinth.versions(projectId))[0];
    if (!v) throw new Error('У этой сборки нет файлов для скачивания');
    const proj = await modrinth.project(v.project_id);
    icon = proj.icon_url || '';
    source = { projectId: proj.id, versionId: v.id, title: proj.title, version: v.version_number };
    const f = modrinth.primaryFile(v);
    packFile = path.join(paths.cache, 'modpacks', `${v.id}.mrpack`);
    onProgress?.({ stage: `Скачиваем сборку ${proj.title}`, percent: 0 });
    await download(f.url, packFile, (d, t) => onProgress?.({ stage: `Скачиваем сборку ${proj.title}`, percent: t ? Math.round(d / t * 100) : 0 }));
  }
  const zip = new AdmZip(packFile);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('Это не сборка Modrinth (.mrpack)');
  const index = JSON.parse(indexEntry.getData().toString('utf8'));
  const deps = index.dependencies || {};
  if (!deps.minecraft) throw new Error('В сборке не указана версия Minecraft');
  if (deps.neoforge) throw new Error('Сборки на NeoForge пока не поддерживаются');
  const loader = deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : deps.forge ? 'forge' : 'vanilla';
  const loaderVersion = deps['fabric-loader'] || deps['quilt-loader'] || deps.forge || '';

  const inst = create({ name: index.name || source?.title || 'Сборка', mc: deps.minecraft, loader, loaderVersion, icon, source });
  const root = dir(inst.id);
  try {
    const files = (index.files || []).filter(f => f.env?.client !== 'unsupported');
    let done = 0;
    await pool(files, 6, async f => {
      const dest = insideDir(root, f.path);
      await download(f.downloads[0], dest);
      if (f.hashes?.sha1 && sha1(dest) !== f.hashes.sha1) throw new Error(`Файл ${f.path} скачался с ошибкой`);
      done++;
      onProgress?.({ stage: `Файлы сборки: ${done} из ${files.length}`, percent: Math.round(done / files.length * 100) });
    });
    // overrides — настройки, конфиги и ресурсы сборки
    for (const e of zip.getEntries()) {
      const m = e.entryName.match(/^(client-overrides|overrides)\/(.+)$/);
      if (!m || e.isDirectory) continue;
      const dest = insideDir(root, m[2]);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
    }
  } catch (e) {
    remove(inst.id);
    throw e;
  }
  return get(inst.id);
}

// Мод с CurseForge, который не отдаётся (автор запретил лаунчеры или зеркало не пускает):
// многие авторы выкладывают те же моды на Modrinth под тем же именем — берём оттуда
async function modrinthTwin(cfMod, mc, loader, kind) {
  if (!cfMod?.slug) return null;
  try {
    const proj = await modrinth.project(cfMod.slug);
    const type = kind === 'mods' ? 'mod' : kind === 'shaderpacks' ? 'shader' : 'resourcepack';
    if (proj.project_type !== type) return null;
    const v = (await modrinth.versions(proj.id, { mc, loader, type }))[0];
    if (!v) return null;
    const f = modrinth.primaryFile(v);
    return { id: proj.id, title: proj.title, icon: proj.icon_url || '', url: f.url, fileName: f.filename, sha1: f.hashes?.sha1, versionId: v.id, version: v.version_number };
  } catch { return null; }
}

// ── Сборки CurseForge (.zip с manifest.json) ─────────────────────
const CF_FOLDER = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' };

async function installCfPack({ projectId, fileId, file }, onProgress) {
  let packFile = file;
  let source = null;
  let icon = '';
  if (projectId || fileId) {
    const proj = await curseforge.project(projectId);
    icon = proj.logo?.thumbnailUrl || '';
    const f = fileId ? await curseforge.filesByRef([{ projectID: projectId, fileID: fileId }]).then(l => l[0]) : (await curseforge.files(projectId))[0];
    if (!f || f.missing) throw new Error('У этой сборки нет файлов для скачивания');
    if (!f.downloadUrl) throw new Error(`Автор запретил скачивать эту сборку из лаунчеров. Скачай .zip с сайта ${curseforge.pageUrl(proj, 'modpacks')} и нажми «Импорт файла».`);
    source = { source: 'curseforge', projectId: String(proj.id), versionId: String(f.id), title: proj.name, version: f.displayName };
    packFile = path.join(paths.cache, 'modpacks', `cf-${f.id}.zip`);
    onProgress?.({ stage: `Скачиваем сборку ${proj.name}`, percent: 0 });
    await download(f.downloadUrl, packFile, (d, t) => onProgress?.({ stage: `Скачиваем сборку ${proj.name}`, percent: t ? Math.round(d / t * 100) : 0 }));
  }
  const zip = new AdmZip(packFile);
  const entry = zip.getEntry('manifest.json');
  if (!entry) throw new Error('Это не сборка CurseForge: внутри нет manifest.json');
  const man = JSON.parse(entry.getData().toString('utf8'));
  const mc = man.minecraft?.version;
  if (!mc) throw new Error('В сборке не указана версия Minecraft');
  const ml = (man.minecraft.modLoaders || []).find(l => l.primary) || man.minecraft.modLoaders?.[0];
  let loader = 'vanilla';
  let loaderVersion = '';
  if (ml) {
    const [kind, ...rest] = ml.id.split('-');
    if (kind === 'neoforge') throw new Error('Сборки на NeoForge пока не поддерживаются');
    if (!['forge', 'fabric', 'quilt'].includes(kind)) throw new Error(`Неизвестный загрузчик сборки: ${ml.id}`);
    loader = kind;
    loaderVersion = rest.join('-');
  }

  const inst = create({ name: man.name || source?.title || 'Сборка', mc, loader, loaderVersion, icon, source });
  const root = dir(inst.id);
  const blocked = [];
  try {
    const refs = (man.files || []).filter(f => f.required !== false);
    onProgress?.({ stage: 'Получаем список модов…', percent: 0 });
    const files = await curseforge.filesByRef(refs);
    const mods = new Map();
    for (const m of await curseforge.projects(files.map(f => f.modId))) mods.set(m.id, m);
    const meta = readMeta(inst.id);
    let done = 0;
    await pool(files, 6, async f => {
      const m = mods.get(f.modId);
      const folder = CF_FOLDER[m?.classId] || (f.missing || /\.jar$/i.test(f.fileName) ? 'mods' : 'resourcepacks');
      const name = path.basename(f.fileName);
      const twin = (f.missing || !f.downloadUrl) ? await modrinthTwin(m, mc, loader === 'vanilla' ? null : loader, folder) : null;
      if (twin) {
        const tname = path.basename(twin.fileName);
        const dest = insideDir(root, `${folder}/${tname}`);
        await download(twin.url, dest);
        if (twin.sha1 && sha1(dest) !== twin.sha1) throw new Error(`Файл ${tname} скачался с ошибкой`);
        meta.files[`${folder}/${tname}`] = { projectId: twin.id, versionId: twin.versionId, title: twin.title, icon: twin.icon, version: twin.version, source: 'modrinth' };
      } else if (f.missing || !f.downloadUrl) {
        blocked.push({ title: m?.name || name, fileName: name, folder, url: m ? curseforge.pageUrl(m) : `https://www.curseforge.com/projects/${f.modId}` });
      } else {
        const dest = insideDir(root, `${folder}/${name}`);
        await download(f.downloadUrl, dest);
        const want = curseforge.sha1Of(f);
        if (want && sha1(dest) !== want) throw new Error(`Файл ${name} скачался с ошибкой`);
        meta.files[`${folder}/${name}`] = { projectId: String(f.modId), versionId: String(f.id), title: m?.name || name, icon: m?.logo?.thumbnailUrl || '', version: f.displayName, source: 'curseforge' };
      }
      done++;
      onProgress?.({ stage: `Файлы сборки: ${done} из ${files.length}`, percent: Math.round(done / files.length * 100) });
    });
    meta.blocked = blocked;
    writeMeta(inst.id, meta);
    const over = (man.overrides || 'overrides').replace(/\/+$/, '') + '/';
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(over)) continue;
      const dest = insideDir(root, e.entryName.slice(over.length));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
    }
  } catch (e) {
    remove(inst.id);
    throw e;
  }
  return { ...get(inst.id), blocked };
}

// Импорт файла: .mrpack (Modrinth) или .zip (CurseForge)
function importPack(file, onProgress) {
  const zip = new AdmZip(file);
  if (zip.getEntry('modrinth.index.json')) return installMrpack({ file }, onProgress);
  if (zip.getEntry('manifest.json')) return installCfPack({ file }, onProgress);
  throw new Error('Это не сборка: нужен файл .mrpack с Modrinth или .zip с CurseForge');
}

// ── Обновление модов ─────────────────────────────────────────────
// Modrinth узнаёт мод по sha1 файла, поэтому так находятся обновления и для модов,
// поставленных вручную или с CurseForge, если тот же файл лежит на Modrinth
function hashFolder(id, folder, re) {
  const d = path.join(dir(id), folder);
  const out = {};
  let files = [];
  try { files = fs.readdirSync(d); } catch { return out; }
  for (const f of files) {
    const full = path.join(d, f);
    if (re.test(f) && fs.statSync(full).isFile()) out[sha1(full)] = f;
  }
  return out;
}

async function checkUpdates(id) {
  const meta = readMeta(id);
  if (!meta) throw new Error('Сборка не найдена');
  if (meta.loader === 'vanilla') return [];
  const byHash = hashFolder(id, 'mods', /\.jar(\.disabled)?$/i);
  const hashes = Object.keys(byHash);
  if (!hashes.length) return [];
  const loaders = meta.loader === 'quilt' ? ['quilt', 'fabric'] : [modrinth.LOADER_TAG[meta.loader]];
  let latest;
  try { latest = await modrinth.latestByHash(hashes, { loaders, mc: meta.mc }); }
  catch (e) { throw new Error('Modrinth не ответил, попробуй позже (' + e.message + ')'); }
  const out = [];
  for (const [hash, v] of Object.entries(latest || {})) {
    const file = byHash[hash];
    const pf = v && modrinth.primaryFile(v);
    if (!file || !pf || pf.hashes?.sha1 === hash) continue;
    const base = file.replace(/\.disabled$/i, '');
    const known = meta.files?.[`mods/${base}`];
    const name = known?.title || readModInfo(path.join(dir(id), 'mods', file)).name || base.replace(/\.jar$/i, '');
    out.push({ file, name, icon: known?.icon || '', from: known?.version || readModInfo(path.join(dir(id), 'mods', file)).version || '',
      to: v.version_number, projectId: v.project_id, versionId: v.id, fileName: pf.filename, url: pf.url, sha1: pf.hashes?.sha1 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function applyUpdates(id, list, onProgress) {
  const meta = readMeta(id);
  if (!meta) throw new Error('Сборка не найдена');
  const d = path.join(dir(id), 'mods');
  meta.files = meta.files || {};
  let done = 0;
  const failed = [];
  for (const u of list || []) {
    onProgress?.({ stage: `Обновляем ${u.name}`, percent: Math.round(done / list.length * 100) });
    try {
      const old = safeFile(id, 'mods', u.file);
      const fileName = path.basename(String(u.fileName));
      if (!/\.jar$/i.test(fileName) || !/^https:\/\/cdn\.modrinth\.com\//.test(u.url)) throw new Error('неверный файл');
      const disabled = /\.disabled$/i.test(u.file);
      const tmp = path.join(d, fileName + '.km-new');
      await download(u.url, tmp);
      if (u.sha1 && sha1(tmp) !== u.sha1) { fs.rmSync(tmp, { force: true }); throw new Error('файл скачался с ошибкой'); }
      const oldBase = u.file.replace(/\.disabled$/i, '');
      const prev = meta.files[`mods/${oldBase}`];
      fs.rmSync(old, { force: true });
      delete meta.files[`mods/${oldBase}`];
      fs.renameSync(tmp, path.join(d, fileName + (disabled ? '.disabled' : '')));
      meta.files[`mods/${fileName}`] = { ...(prev || {}), projectId: u.projectId, versionId: u.versionId, title: prev?.title || u.name,
        icon: prev?.icon || u.icon || '', version: u.to, source: 'modrinth' };
      writeMeta(id, meta);
    } catch (e) { failed.push(`${u.name}: ${e.message}`); }
    done++;
  }
  onProgress?.({ stage: 'Моды обновлены', percent: 100 });
  return { updated: done - failed.length, failed };
}

// ── Экспорт сборки в .mrpack, чтобы поделиться с друзьями ────────
// Файлы, которые есть на Modrinth, записываются ссылками (файл получается маленьким),
// остальное (моды вручную, конфиги, настройки) кладётся внутрь как overrides
const EXPORT_FOLDERS = [['mods', /\.jar$/i], ['resourcepacks', /\.zip$/i], ['shaderpacks', /\.zip$/i]];
const EXPORT_EXTRA = ['config', 'defaultconfigs', 'kubejs', 'options.txt', 'servers.dat'];
const LOADER_DEP = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge' };

async function exportMrpack(id, dest, onProgress) {
  const meta = readMeta(id);
  if (!meta) throw new Error('Сборка не найдена');
  const root = dir(id);
  const deps = { minecraft: meta.mc };
  if (meta.loader !== 'vanilla') {
    let lv = meta.loaderVersion || meta.loaderResolved;
    if (!lv) lv = await versions.recommendedLoader(meta.loader, meta.mc);
    if (!lv) throw new Error('Не удалось узнать версию загрузчика: запусти сборку один раз и попробуй снова');
    deps[LOADER_DEP[meta.loader]] = lv;
  }
  onProgress?.({ stage: 'Собираем список файлов…', percent: 5 });
  const local = {};
  for (const [folder, re] of EXPORT_FOLDERS) {
    for (const [hash, f] of Object.entries(hashFolder(id, folder, re))) local[hash] = `${folder}/${f}`;
  }
  let remote = {};
  const hashes = Object.keys(local);
  if (hashes.length) {
    onProgress?.({ stage: 'Ищем файлы на Modrinth…', percent: 20 });
    try { remote = await modrinth.versionsByHash(hashes) || {}; } catch { remote = {}; } // без сети всё уйдёт внутрь файла
  }
  const zip = new AdmZip();
  const files = [];
  let inside = 0;
  for (const [hash, rel] of Object.entries(local)) {
    const full = path.join(root, rel);
    const f = remote[hash]?.files?.find(x => x.hashes?.sha1 === hash);
    if (f?.url) {
      const data = fs.readFileSync(full);
      files.push({
        path: rel,
        hashes: { sha1: hash, sha512: crypto.createHash('sha512').update(data).digest('hex') },
        env: { client: 'required', server: rel.startsWith('mods/') ? 'required' : 'unsupported' },
        downloads: [f.url], fileSize: data.length,
      });
    } else {
      zip.addLocalFile(full, `overrides/${path.dirname(rel)}`);
      inside++;
    }
  }
  onProgress?.({ stage: 'Добавляем настройки и конфиги…', percent: 70 });
  for (const extra of EXPORT_EXTRA) {
    const full = path.join(root, extra);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isDirectory()) zip.addLocalFolder(full, `overrides/${extra}`);
    else zip.addLocalFile(full, 'overrides');
  }
  const index = {
    formatVersion: 1, game: 'minecraft', versionId: new Date().toISOString().slice(0, 10),
    name: meta.name, summary: 'Сборка из KM Launcher', files, dependencies: deps,
  };
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)));
  onProgress?.({ stage: 'Сохраняем файл…', percent: 90 });
  zip.writeZip(dest);
  onProgress?.({ stage: 'Готово', percent: 100 });
  return { file: dest, linked: files.length, inside, size: fs.statSync(dest).size };
}

// ── Резервная копия мира ─────────────────────────────────────────
function backupWorld(id, world) {
  const src = safeFile(id, 'saves', world);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error('Мир не найден');
  const out = path.join(dir(id), 'backups');
  fs.mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const file = path.join(out, `${world.replace(/[^\p{L}\p{N} ._-]/gu, '_')} ${stamp}.zip`);
  const zip = new AdmZip();
  zip.addLocalFolder(src, world);
  zip.writeZip(file);
  return { file, size: fs.statSync(file).size };
}

module.exports = {
  dir, list, get, create, update, remove, duplicate,
  content, toggle, removeFile, addFiles, installProject, installMrpack, installCfPack, importPack, KINDS,
  checkUpdates, applyUpdates, exportMrpack, backupWorld,
};

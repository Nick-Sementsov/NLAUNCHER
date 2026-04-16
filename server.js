'use strict';
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs-extra');
const multer   = require('multer');
const https    = require('https');
const http     = require('http');
const { createHash } = require('crypto');

const app      = express();
const PORT     = process.env.PORT || 3000;
const BASE     = __dirname;
const DATA_DIR = path.join(BASE, 'data');
const MODS_DIR = path.join(BASE, 'mods');
const PUB_DIR  = path.join(BASE, 'public');

fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(MODS_DIR);
fs.ensureDirSync(PUB_DIR);

// ── Default data ──────────────────────────────────────────────────────────────
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const DEFAULT = {
  builds: [{
    id: 'forge-1.20.1',
    name: 'Forge 1.20.1',
    version: '1.20.1',
    forgeVersion: '47.3.0',
    type: 'forge',
    description: 'Основная сборка сервера с модами',
    mods: [],
    active: true,
    created: new Date().toISOString()
  }],
  news: [{
    id: 1,
    title: 'Добро пожаловать!',
    body: 'Сервер открыт для всех игроков.',
    date: new Date().toISOString(),
    tag: 'Новости'
  }],
  players: [],
  settings: {
    serverName: 'NLauncher Server',
    serverIp: '',
    minRam: 2,
    maxRam: 16,
    defaultBuild: 'forge-1.20.1',
    offlineMode: true,
    launcherVersion: '1.0.0',
    updateUrl: 'https://nlauncher-production.up.railway.app'
  }
};

if (!fs.existsSync(DATA_FILE)) fs.writeJsonSync(DATA_FILE, DEFAULT, { spaces: 2 });

function readData()    { return fs.readJsonSync(DATA_FILE); }
function writeData(d)  { fs.writeJsonSync(DATA_FILE, d, { spaces: 2 }); }
function uuid4()       { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16);}); }

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, MODS_DIR),
  filename:    (_, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g,'_'))
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB per file
  fileFilter: (_, file, cb) => {
    const ok = /\.(jar|zip)$/i.test(file.originalname);
    cb(ok ? null : new Error('Только .jar и .zip'), ok);
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(PUB_DIR));
// Serve mod files directly to launcher
app.use('/mods', express.static(MODS_DIR));

// ── HTTP download helper ──────────────────────────────────────────────────────
function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 30000, ...opts }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return httpGet(res.headers.location, opts).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    fs.ensureDirSync(path.dirname(dest));
    const tmp = dest + '.tmp';
    const mod = url.startsWith('https') ? https : http;

    mod.get(url, { timeout: 60000 }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return downloadFile(res.headers.location, dest, onProgress).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ' — ' + url));

      const total = parseInt(res.headers['content-length'] || '0');
      let done = 0;
      const file = fs.createWriteStream(tmp);

      res.on('data', chunk => {
        done += chunk.length;
        if (onProgress && total) onProgress(Math.round(done / total * 100));
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try { if (fs.existsSync(dest)) fs.removeSync(dest); fs.renameSync(tmp, dest); resolve(); }
          catch (e) { try { fs.copyFileSync(tmp, dest); fs.removeSync(tmp); resolve(); } catch(e2) { reject(e2); } }
        });
      });
      file.on('error', e => { fs.removeSync(tmp); reject(e); });
    }).on('error', e => { try { fs.removeSync(tmp); } catch(_){} reject(e); });
  });
}

// ── Modrinth API ──────────────────────────────────────────────────────────────
async function searchModrinth(query, gameVersion, loader = 'forge') {
  const facets = JSON.stringify([
    ['project_type:mod'],
    ...(gameVersion ? [[`versions:${gameVersion}`]] : []),
    ...(loader ? [[`categories:${loader}`]] : [])
  ]);
  const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}&limit=10`;
  const { body } = await httpGet(url, { headers: { 'User-Agent': 'NLauncher/2.0' } });
  return JSON.parse(body).hits || [];
}

async function getModrinthVersions(projectId, gameVersion, loader = 'forge') {
  let url = `https://api.modrinth.com/v2/project/${projectId}/version?loaders=["${loader}"]`;
  if (gameVersion) url += `&game_versions=["${gameVersion}"]`;
  const { body } = await httpGet(url, { headers: { 'User-Agent': 'NLauncher/2.0' } });
  return JSON.parse(body);
}

async function downloadModrinthMod(projectId, gameVersion, loader, buildId) {
  const versions = await getModrinthVersions(projectId, gameVersion, loader);
  if (!versions.length) throw new Error('Нет совместимой версии мода для ' + gameVersion + ' + ' + loader);

  const ver = versions[0];
  const file = ver.files.find(f => f.primary) || ver.files[0];
  if (!file) throw new Error('Нет файла в версии мода');

  const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const dest = path.join(MODS_DIR, Date.now() + '_' + safeName);

  await downloadFile(file.url, dest);

  const d = readData();
  const build = d.builds.find(b => b.id === buildId);
  if (!build) throw new Error('Сборка не найдена');

  build.mods = build.mods || [];
  build.mods.push({
    name:       file.filename,
    file:       path.basename(dest),
    size:       fs.statSync(dest).size,
    source:     'modrinth',
    projectId,
    uploadedAt: new Date().toISOString(),
    sha512:     file.hashes?.sha512 || ''
  });
  writeData(d);
  return build.mods[build.mods.length - 1];
}

// ── Forge version list ────────────────────────────────────────────────────────
async function getForgeVersions(mcVersion) {
  try {
    const { body } = await httpGet(
      `https://files.minecraftforge.net/net/minecraftforge/forge/index_${mcVersion}.html`,
      { headers: { 'User-Agent': 'NLauncher/2.0', 'Accept': 'text/html' } }
    );
    const matches = [...body.matchAll(/forge-([0-9.]+-[0-9.]+)-installer\.jar/g)];
    const unique = [...new Set(matches.map(m => m[1]))];
    return unique.slice(0, 15);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCHER API — used by NLauncher.exe
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/launcher/config', (req, res) => {
  const d = readData();
  const builds = d.builds.filter(b => b.active).map(b => ({
    id:          b.id,
    name:        b.name,
    version:     b.version,
    forgeVersion:b.forgeVersion || null,
    type:        b.type,
    description: b.description,
    modCount:    (b.mods || []).length,
    // include mod manifest so launcher knows what to sync
    mods: (b.mods || []).map(m => ({
      name: m.name,
      file: m.file,
      size: m.size,
      url:  `${d.settings.updateUrl}/mods/${m.file}`,
      sha512: m.sha512 || ''
    }))
  }));
  res.json({ settings: d.settings, builds });
});

app.get('/api/launcher/news', (req, res) => {
  res.json(readData().news.slice(0, 5));
});

app.post('/api/launcher/player', (req, res) => {
  const { nickname } = req.body;
  if (!nickname) return res.status(400).json({ error: 'No nickname' });
  const d = readData();
  let p = d.players.find(p => p.nickname === nickname);
  if (!p) {
    p = { nickname, uuid: uuid4(), firstJoin: new Date().toISOString(), lastJoin: new Date().toISOString(), joinCount: 1 };
    d.players.push(p);
  } else {
    p.lastJoin = new Date().toISOString();
    p.joinCount = (p.joinCount || 0) + 1;
  }
  writeData(d);
  res.json(p);
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN API
// ─────────────────────────────────────────────────────────────────────────────

// Stats
app.get('/api/admin/stats', (req, res) => {
  const d = readData();
  const totalMods = d.builds.reduce((s, b) => s + (b.mods||[]).length, 0);
  res.json({
    totalPlayers: d.players.length,
    totalBuilds:  d.builds.length,
    activeBuilds: d.builds.filter(b => b.active).length,
    totalNews:    d.news.length,
    totalMods
  });
});

// Builds CRUD
app.get('/api/admin/builds',     (req, res) => res.json(readData().builds));

app.post('/api/admin/builds', (req, res) => {
  const d = readData();
  const b = { ...req.body, id: Date.now().toString(), mods: [], created: new Date().toISOString() };
  d.builds.push(b);
  writeData(d);
  res.json(b);
});

app.put('/api/admin/builds/:id', (req, res) => {
  const d = readData();
  const i = d.builds.findIndex(b => b.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  d.builds[i] = { ...d.builds[i], ...req.body, id: req.params.id };
  writeData(d);
  res.json(d.builds[i]);
});

app.delete('/api/admin/builds/:id', (req, res) => {
  const d = readData();
  const build = d.builds.find(b => b.id === req.params.id);
  if (build) {
    // delete mod files
    (build.mods||[]).forEach(m => { try { fs.removeSync(path.join(MODS_DIR, m.file)); } catch(_){} });
  }
  d.builds = d.builds.filter(b => b.id !== req.params.id);
  writeData(d);
  res.json({ ok: true });
});

// Upload mod file
app.post('/api/admin/builds/:id/mods/upload', upload.single('mod'), (req, res) => {
  const d = readData();
  const build = d.builds.find(b => b.id === req.params.id);
  if (!build) return res.status(404).json({ error: 'Build not found' });
  build.mods = build.mods || [];
  build.mods.push({
    name:       req.file.originalname,
    file:       req.file.filename,
    size:       req.file.size,
    source:     'upload',
    uploadedAt: new Date().toISOString()
  });
  writeData(d);
  res.json(build.mods[build.mods.length - 1]);
});

// Search Modrinth
app.get('/api/admin/modrinth/search', async (req, res) => {
  try {
    const { q, version, loader = 'forge' } = req.query;
    if (!q) return res.status(400).json({ error: 'q required' });
    const results = await searchModrinth(q, version, loader);
    res.json(results.map(r => ({
      id:          r.project_id,
      slug:        r.slug,
      name:        r.title,
      description: r.description,
      downloads:   r.downloads,
      icon:        r.icon_url,
      categories:  r.categories,
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Download mod from Modrinth
app.post('/api/admin/builds/:id/mods/modrinth', async (req, res) => {
  try {
    const { projectId, gameVersion, loader = 'forge' } = req.body;
    const mod = await downloadModrinthMod(projectId, gameVersion, loader, req.params.id);
    res.json(mod);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get Forge versions for MC version
app.get('/api/admin/forge/versions', async (req, res) => {
  try {
    const { mcVersion } = req.query;
    if (!mcVersion) return res.status(400).json({ error: 'mcVersion required' });
    const versions = await getForgeVersions(mcVersion);
    res.json(versions);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete mod
app.delete('/api/admin/builds/:id/mods/:filename', (req, res) => {
  const d = readData();
  const build = d.builds.find(b => b.id === req.params.id);
  if (!build) return res.status(404).json({ error: 'Build not found' });
  const f = path.join(MODS_DIR, req.params.filename);
  if (fs.existsSync(f)) fs.removeSync(f);
  build.mods = (build.mods||[]).filter(m => m.file !== req.params.filename);
  writeData(d);
  res.json({ ok: true });
});

// News
app.get('/api/admin/news',     (req, res) => res.json(readData().news));
app.post('/api/admin/news',    (req, res) => {
  const d = readData();
  const n = { ...req.body, id: Date.now(), date: new Date().toISOString() };
  d.news.unshift(n); writeData(d); res.json(n);
});
app.delete('/api/admin/news/:id', (req, res) => {
  const d = readData();
  d.news = d.news.filter(n => n.id != req.params.id); writeData(d); res.json({ ok: true });
});

// Players
app.get('/api/admin/players',           (req, res) => res.json(readData().players));
app.delete('/api/admin/players/:nick',  (req, res) => {
  const d = readData();
  d.players = d.players.filter(p => p.nickname !== req.params.nick); writeData(d); res.json({ ok: true });
});

// Settings
app.get('/api/admin/settings',  (req, res) => res.json(readData().settings));
app.put('/api/admin/settings',  (req, res) => {
  const d = readData();
  d.settings = { ...d.settings, ...req.body }; writeData(d); res.json(d.settings);
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 NLauncher Admin Panel v2.0`);
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   Railway: https://nlauncher-production.up.railway.app\n`);
});

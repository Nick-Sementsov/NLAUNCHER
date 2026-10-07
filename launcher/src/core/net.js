'use strict';
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const UA = 'KMLauncher/1.0';

function request(url, { timeout = 30000, headers = {} } = {}, redirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout, headers: { 'User-Agent': UA, ...headers } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(request(new URL(res.headers.location, url).toString(), { timeout, headers }, redirects - 1));
      }
      resolve(res);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Превышено время ожидания: ' + url)));
  });
}

async function getJson(url, opts) {
  const res = await request(url, opts);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}: ${url}`);
  return JSON.parse(body);
}

async function download(url, dest, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await request(url, { timeout: 60000 });
  if (res.statusCode >= 400) { res.resume(); throw new Error(`HTTP ${res.statusCode}: ${url}`); }
  const total = parseInt(res.headers['content-length'] || '0', 10);
  let done = 0;
  const tmp = dest + '.part';
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.on('data', c => {
      done += c.length;
      if (onProgress) onProgress(done, total);
    });
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    res.pipe(out);
  });
  fs.renameSync(tmp, dest);
}

// POST с JSON-телом (нужен CurseForge для пакетных запросов)
function postJson(url, data, { timeout = 30000, headers = {} } = {}) {
  const body = Buffer.from(JSON.stringify(data));
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: 'POST', timeout,
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Content-Length': body.length, ...headers },
    }, async res => {
      try {
        const chunks = [];
        for await (const c of res) chunks.push(c);
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        resolve(JSON.parse(text));
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Превышено время ожидания: ' + url)));
    req.end(body);
  });
}

module.exports = { request, getJson, postJson, download, UA };

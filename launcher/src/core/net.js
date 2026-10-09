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

function postJson(url, data, { timeout = 30000 } = {}) {
  const body = Buffer.from(JSON.stringify(data));
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST', timeout,
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, async res => {
      const chunks = [];
      try { for await (const c of res) chunks.push(c); } catch (e) { return reject(e); }
      const text = Buffer.concat(chunks).toString('utf8');
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      try { resolve(JSON.parse(text)); } catch { reject(new Error('Неверный ответ сервера: ' + url)); }
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Превышено время ожидания: ' + url)));
    req.end(body);
  });
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

module.exports = { request, getJson, postJson, download, UA };

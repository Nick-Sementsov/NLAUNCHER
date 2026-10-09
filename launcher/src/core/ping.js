'use strict';
// Пинг сервера Minecraft (Server List Ping): онлайн, слоты, описание
const net = require('net');
const dns = require('dns').promises;

function varint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

function readVarint(buf, off) {
  let n = 0, shift = 0, b;
  do {
    if (off >= buf.length) return null;
    b = buf[off++];
    n |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  return [n >>> 0, off];
}

function parseAddress(address) {
  const [host, port] = String(address).trim().split(':');
  return { host, port: port ? parseInt(port, 10) : null };
}

async function resolve(address) {
  const { host, port } = parseAddress(address);
  if (port) return { host, port };
  try {
    const [srv] = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (srv) return { host: srv.name, port: srv.port };
  } catch { /* нет SRV-записи */ }
  return { host, port: 25565 };
}

function textOf(desc) {
  if (!desc) return '';
  if (typeof desc === 'string') return desc.replace(/§./g, '');
  return ((desc.text || '') + (desc.extra || []).map(textOf).join('')).replace(/§./g, '');
}

async function ping(address, timeout = 5000) {
  const { host, port } = await resolve(address);
  const started = Date.now();
  return new Promise((ok, fail) => {
    const sock = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    const done = (err, res) => { sock.destroy(); err ? fail(err) : ok(res); };
    sock.setTimeout(timeout, () => done(new Error('Сервер не отвечает')));
    sock.on('error', e => done(e));
    sock.on('connect', () => {
      const hostBuf = Buffer.from(host, 'utf8');
      const portBuf = Buffer.alloc(2); portBuf.writeUInt16BE(port);
      sock.write(packet(0x00, Buffer.concat([varint(767), varint(hostBuf.length), hostBuf, portBuf, varint(1)])));
      sock.write(packet(0x00, Buffer.alloc(0)));
    });
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      const len = readVarint(buf, 0);
      if (!len || buf.length < len[1] + len[0]) return;
      const id = readVarint(buf, len[1]);
      const strLen = readVarint(buf, id[1]);
      const json = JSON.parse(buf.slice(strLen[1], strLen[1] + strLen[0]).toString('utf8'));
      done(null, {
        online: true,
        players: json.players?.online ?? 0,
        max: json.players?.max ?? 0,
        version: json.version?.name || '',
        motd: textOf(json.description),
        latency: Date.now() - started,
      });
    });
  });
}

module.exports = { ping };

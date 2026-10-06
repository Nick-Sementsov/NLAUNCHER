'use strict';
const fs = require('fs');
const paths = require('./paths');

const DEFAULTS = {
  accounts: [],            // { id, type: 'microsoft' | 'offline', name, uuid, refreshToken? }
  selectedAccount: null,
  selectedVersion: null,   // { kind: 'vanilla' | 'fabric' | 'server', id }
  showSnapshots: false,
  memoryMb: 4096,
  resolution: { width: 1280, height: 720, fullscreen: false },
  closeOnLaunch: false,
  jvmArgs: '',
  panelUrl: 'https://nlauncher-production.up.railway.app',
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(paths.config, 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save() {
  const tmp = paths.config + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, paths.config);
}

function get() { return load(); }

function update(patch) {
  load();
  Object.assign(cache, patch);
  save();
  return cache;
}

module.exports = { get, update, save, DEFAULTS };

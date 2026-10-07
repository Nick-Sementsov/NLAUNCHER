'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('km', {
  info: () => call('app:info'),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  settings: {
    get: () => call('settings:get'),
    update: patch => call('settings:update', patch),
  },
  accounts: {
    list: () => call('accounts:list'),
    addOffline: name => call('accounts:addOffline', name),
    addMicrosoft: () => call('accounts:addMicrosoft'),
    remove: id => call('accounts:remove', id),
    select: id => call('accounts:select', id),
  },
  versions: (showSnapshots) => call('versions:list', showSnapshots),
  panel: {
    config: () => call('panel:config'),
    news: () => call('panel:news'),
  },
  ping: address => call('server:ping', address),
  openFolder: which => call('folder:open', which),
  launch: target => call('game:launch', target),
  stop: () => call('game:stop'),
  instances: {
    list: () => call('instances:list'),
    get: id => call('instances:get', id),
    create: opts => call('instances:create', opts),
    update: (id, patch) => call('instances:update', id, patch),
    remove: id => call('instances:remove', id),
    duplicate: id => call('instances:duplicate', id),
    content: (id, kind) => call('instances:content', id, kind),
    toggle: (id, kind, file) => call('instances:toggle', id, kind, file),
    removeFile: (id, kind, file) => call('instances:removeFile', id, kind, file),
    addFiles: (id, kind) => call('instances:addFiles', id, kind),
    install: (id, projectId, type) => call('instances:install', id, projectId, type),
  },
  modpack: {
    install: ref => call('modpack:install', ref),
    import: () => call('modpack:import'),
  },
  modrinth: { search: opts => call('modrinth:search', opts) },
  loaders: (kind, mc) => call('loaders:list', kind, mc),
  installUpdate: () => call('update:install'),
  on: {
    progress: cb => on('launch:progress', cb),
    log: cb => on('launch:log', cb),
    exit: cb => on('launch:exit', cb),
    update: cb => on('update:status', cb),
    content: cb => on('content:progress', cb),
  },
});

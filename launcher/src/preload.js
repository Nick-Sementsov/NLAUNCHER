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
  installUpdate: () => call('update:install'),
  on: {
    progress: cb => on('launch:progress', cb),
    log: cb => on('launch:log', cb),
    exit: cb => on('launch:exit', cb),
    update: cb => on('update:status', cb),
  },
});

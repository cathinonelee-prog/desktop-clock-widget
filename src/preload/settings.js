'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clockSettings', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  getClock: () => ipcRenderer.invoke('clock:state'),
  syncClock: () => ipcRenderer.invoke('clock:sync'),
  getLayout: () => ipcRenderer.invoke('layout:get'),
  resetLayout: () => ipcRenderer.invoke('layout:reset'),
  addInstance: (payload) => ipcRenderer.invoke('instance:add', payload || {}),
  removeInstance: (id) => ipcRenderer.invoke('instance:remove', { id }),
  updateInstance: (id, patch) => ipcRenderer.invoke('instance:update', { id, patch }),
  onePerDisplay: () => ipcRenderer.invoke('instances:one-per-display'),
  refreshDisplays: () => ipcRenderer.invoke('layout:get'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  quit: () => ipcRenderer.invoke('app:quit'),
  close: () => ipcRenderer.send('settings:close'),
  minimize: () => ipcRenderer.send('settings:minimize'),
  onConfig: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('config:changed', handler);
    return () => ipcRenderer.removeListener('config:changed', handler);
  },
  onClock: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('clock:state', handler);
    return () => ipcRenderer.removeListener('clock:state', handler);
  },
  onTab: (cb) => {
    ipcRenderer.on('settings:tab', (_e, tab) => cb(tab));
  },
});

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const params = new URLSearchParams(globalThis.location.search);
const instanceId = params.get('instance') || 'main';

contextBridge.exposeInMainWorld('clockWidget', {
  instanceId,
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  getClock: () => ipcRenderer.invoke('clock:state'),
  syncClock: () => ipcRenderer.invoke('clock:sync'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
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
  resize: (size) => ipcRenderer.send('widget:size', size),
  contextMenu: () => ipcRenderer.send('widget:contextmenu', instanceId),
  openSettings: () => ipcRenderer.invoke('app:openSettings'),
  dragStart: (point) => ipcRenderer.send('widget:drag-start', point),
  dragMove: (point) => ipcRenderer.send('widget:drag-move', point),
  dragEnd: () => ipcRenderer.send('widget:drag-end'),
});

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clockCalendar', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  getClock: () => ipcRenderer.invoke('clock:state'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  resize: (size) => ipcRenderer.send('calendar:size', size),
  panelRect: (rect) => ipcRenderer.send('calendar:panel-rect', rect),
  pointerEnter: () => ipcRenderer.send('calendar:enter'),
  pointerLeave: () => ipcRenderer.send('calendar:leave'),
  close: () => ipcRenderer.send('calendar:close'),
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
  onOpacity: (cb) => {
    ipcRenderer.on('calendar:opacity', (_e, payload) => cb(payload));
  },
});

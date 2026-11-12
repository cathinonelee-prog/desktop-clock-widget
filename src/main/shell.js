'use strict';

const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('node:path');

/** 深链接/资源服务：用 app://clock/... 提供 src 下的本地文件，避免 file:// 的模块与 fetch 限制 */
function registerAppProtocol(rootDir) {
  const { protocol } = require('electron');
  const baseDir = path.normalize(path.join(rootDir, 'src'));
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const filePath = path.normalize(path.join(baseDir, rel));
      if (!filePath.startsWith(baseDir)) {
        return new Response('forbidden', { status: 403 });
      }
      const data = await require('node:fs/promises').readFile(filePath);
      return new Response(data, { headers: { 'content-type': mimeOf(filePath) } });
    } catch (err) {
      console.error('[protocol] serve failed', request.url, err.message);
      return new Response('not found', { status: 404 });
    }
  });
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  };
  return map[ext] || 'application/octet-stream';
}

/** 设置窗口：单例 */
function createSettingsWindow({ rootDir, parent, tab }) {
  const win = new BrowserWindow({
    width: 1020,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#0b0f14',
    title: '悬浮时钟 · 设置',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(rootDir, 'src', 'preload', 'settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  win.loadURL('app://clock/renderer/settings.html' + (tab ? `?tab=${encodeURIComponent(tab)}` : ''));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    /* 单例由调用方清理 */
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

module.exports = { registerAppProtocol, createSettingsWindow, mimeOf };

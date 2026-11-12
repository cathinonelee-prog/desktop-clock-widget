'use strict';

const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_SIZE = { width: 340, height: 150 };
const EDGE_SNAP = 18;

/** 读写的窗口位置存储（与 config 分离，避免拖动时反复写配置） */
class LayoutStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {};
    try {
      this.data = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
    } catch {
      this.data = {};
    }
    this.timer = null;
  }

  get(id) {
    const b = this.data[id];
    if (!b || ![b.x, b.y, b.width, b.height].every((n) => Number.isFinite(Number(n)))) return null;
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  }

  set(id, bounds) {
    this.data[id] = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  clear() {
    this.data = {};
    this.flush();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[layout] save failed', err);
    }
  }
}

class WindowManager {
  constructor({ config, clock, rootDir, userDataDir, onRequestSettings, t, log }) {
    this.config = config;
    this.clock = clock;
    this.rootDir = rootDir;
    this.t = t;
    this.log = log;
    this.onRequestSettings = onRequestSettings;
    this.layout = new LayoutStore(path.join(userDataDir, 'layout.json'));
    this.windows = new Map(); // instanceId -> BrowserWindow
    this.ready = new Set();
    this.autoSize = new Map(); // instanceId -> {width, height}
    this.hiddenAll = false;
    this.applying = false;
  }

  get configData() {
    return this.config.get();
  }

  instancePreset(inst) {
    return inst.preset || this.configData.content.preset;
  }

  displayFor(inst) {
    const displays = screen.getAllDisplays();
    if (inst.displayId && inst.displayId !== 'auto') {
      const found = displays.find((d) => String(d.id) === String(inst.displayId));
      if (found) return found;
    }
    if (inst.displayId === 'auto') {
      const idx = this.configData.instances.findIndex((i) => i.id === inst.id);
      if (idx > 0 && displays.length > 1) return displays[idx % displays.length];
    }
    return screen.getPrimaryDisplay();
  }

  defaultBounds(display) {
    const area = display.workArea;
    const m = this.configData.window.margin;
    const size = this.autoSize.get(this.currentId) || DEFAULT_SIZE;
    const w = Math.min(size.width || DEFAULT_SIZE.width, area.width);
    const h = Math.min(size.height || DEFAULT_SIZE.height, area.height);
    return {
      x: Math.round(area.x + area.width - w - m),
      y: Math.round(area.y + area.height - h - m * 2),
      width: Math.round(w),
      height: Math.round(h),
    };
  }

  create(inst) {
    const display = this.displayFor(inst);
    const saved = this.layout.get(inst.id);
    const bounds = saved && this.isVisibleOnAnyDisplay(saved) ? saved : this.defaultBounds(display);
    const cfg = this.configData;

    const win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: true,
      movable: !cfg.window.locked,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: true,
      alwaysOnTop: cfg.window.layer === 'alwaysOnTop',
      acceptFirstMouse: true,
      webPreferences: {
        preload: path.join(this.rootDir, 'src', 'preload', 'widget.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });

    win.setMenuBarVisibility(false);
    if (cfg.window.layer === 'alwaysOnTop') win.setAlwaysOnTop(true, 'floating');
    this.applyWindowBehaviour(win, inst);

    const url = `app://clock/renderer/widget.html?instance=${encodeURIComponent(inst.id)}`;
    win.loadURL(url);

    win.once('ready-to-show', () => {
      if (!this.configData.behavior.startHidden && !this.hiddenAll && !inst.hidden) win.showInactive();
    });
    win.webContents.once('did-finish-load', () => this.ready.add(inst.id));
    win.webContents.on('did-start-loading', () => this.ready.delete(inst.id));
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      if (this.log) this.log(`[widget ${inst.id}] load failed ${code} ${desc} ${url}`);
    });
    win.webContents.on('console-message', (event) => {
      if (this.log) this.log(`[widget ${inst.id}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });

    const persist = () => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      this.layout.set(inst.id, b);
    };
    win.on('moved', persist);
    win.on('resized', persist);
    win.on('closed', () => {
      this.windows.delete(inst.id);
      this.ready.delete(inst.id);
    });

    this.windows.set(inst.id, win);
    return win;
  }

  isVisibleOnAnyDisplay(bounds) {
    return screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      const overlapX = Math.min(a.x + a.width, bounds.x + bounds.width) - Math.max(a.x, bounds.x);
      const overlapY = Math.min(a.y + a.height, bounds.y + bounds.height) - Math.max(a.y, bounds.y);
      return overlapX > 60 && overlapY > 30;
    });
  }

  applyWindowBehaviour(win, inst) {
    if (win.isDestroyed()) return;
    const cfg = this.configData;
    const desktop = cfg.window.layer === 'desktop';
    win.setAlwaysOnTop(!desktop, 'floating');
    win.setSkipTaskbar(true);
    win.setMovable(!cfg.window.locked);
    win.setIgnoreMouseEvents(Boolean(cfg.window.clickThrough), { forward: true });
  }

  /** 让窗口尺寸与内容自适应（渲染进程测量后回调） */
  resizeToContent(win, size) {
    if (win.isDestroyed() || !size) return;
    const width = Math.max(120, Math.min(1600, Math.round(size.width)));
    const height = Math.max(48, Math.min(1000, Math.round(size.height)));
    const b = win.getBounds();
    if (Math.abs(b.width - width) <= 1 && Math.abs(b.height - height) <= 1) return;
    const display = screen.getDisplayMatching(b);
    const area = display.workArea;
    const rightAnchored = Math.abs(b.x + b.width - (area.x + area.width)) < 80;
    const bottomAnchored = Math.abs(b.y + b.height - (area.y + area.height)) < 120;
    let x = rightAnchored ? b.x + b.width - width : b.x;
    let y = b.y;
    if (bottomAnchored) y = b.y + b.height - height;
    x = Math.min(Math.max(area.x - 40, x), area.x + area.width - 60);
    y = Math.min(Math.max(area.y - 20, y), area.y + area.height - 40);
    win.setBounds({ x: Math.round(x), y: Math.round(y), width, height }, false);
    this.layout.set(this.idOf(win), win.getBounds());
  }

  idOf(win) {
    for (const [id, w] of this.windows) if (w === win) return id;
    return null;
  }

  /** 根据配置增删窗口 */
  sync() {
    const cfg = this.configData;
    const wanted = new Map(cfg.instances.map((i) => [i.id, i]));

    for (const [id, win] of [...this.windows]) {
      if (!wanted.has(id)) {
        win.destroy();
        this.windows.delete(id);
      }
    }
    for (const inst of cfg.instances) {
      let win = this.windows.get(inst.id);
      if (!win || win.isDestroyed()) {
        win = this.create(inst);
      }
      this.applyWindowBehaviour(win, inst);
      if (inst.hidden || this.hiddenAll) {
        if (win.isVisible()) win.hide();
      } else if (!win.isVisible()) {
        win.showInactive();
      }
    }
    const all = screen.getAllDisplays();
    for (const [id, win] of this.windows) {
      if (win.isDestroyed()) continue;
      const inst = wanted.get(id);
      if (!inst) continue;
      const b = win.getBounds();
      // 只有「指定的屏幕不存在了」或「整个窗口跑到屏幕外」时才重新摆放，
      // 避免用户手动拖到别的屏幕后被配置同步拽回去
      const targetMissing = inst.displayId !== 'auto' && !all.some((d) => String(d.id) === String(inst.displayId));
      if (targetMissing || !this.isVisibleOnAnyDisplay(b)) {
        win.setBounds(this.defaultBounds(this.displayFor(inst)), false);
      }
    }
  }

  broadcast(channel, payload) {
    for (const [id, win] of this.windows) {
      if (win.isDestroyed()) continue;
      if (channel !== 'clock:state' || this.ready.has(id)) win.webContents.send(channel, payload);
    }
  }

  sendToInstance(id, channel, payload) {
    const win = this.windows.get(id);
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  hideAll() {
    this.hiddenAll = true;
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.hide();
  }

  showAll() {
    this.hiddenAll = false;
    for (const [id, win] of this.windows) {
      const inst = this.configData.instances.find((i) => i.id === id);
      if (win.isDestroyed() || inst?.hidden) continue;
      win.showInactive();
    }
  }

  toggleAll() {
    if (this.hiddenAll) this.showAll();
    else this.hideAll();
  }

  get visibleCount() {
    let n = 0;
    for (const win of this.windows.values()) if (!win.isDestroyed() && win.isVisible()) n += 1;
    return n;
  }

  resetLayout() {
    this.layout.clear();
    for (const [id, win] of this.windows) {
      const inst = this.configData.instances.find((i) => i.id === id);
      if (!inst || win.isDestroyed()) continue;
      win.setBounds(this.defaultBounds(this.displayFor(inst)), false);
    }
  }

  layoutSnapshot() {
    return this.configData.instances.map((inst) => {
      const win = this.windows.get(inst.id);
      const display = this.displayFor(inst);
      return {
        id: inst.id,
        name: inst.name,
        displayId: inst.displayId,
        displayName: display.label || `屏幕 ${display.id}`,
        preset: this.instancePreset(inst),
        bounds: win && !win.isDestroyed() ? win.getBounds() : this.layout.get(inst.id),
        visible: Boolean(win && !win.isDestroyed() && win.isVisible()),
      };
    });
  }

  /** 窗口进入可见区域时做边缘吸附 */
  snapIfNeeded(win) {    if (!this.configData.window.snapToEdges || win.isDestroyed()) return;
    const b = win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    let { x, y } = b;
    if (Math.abs(x - area.x) < EDGE_SNAP) x = area.x;
    if (Math.abs(y - area.y) < EDGE_SNAP) y = area.y;
    if (Math.abs(x + b.width - (area.x + area.width)) < EDGE_SNAP) x = area.x + area.width - b.width;
    if (Math.abs(y + b.height - (area.y + area.height)) < EDGE_SNAP) y = area.y + area.height - b.height;
    if (x !== b.x || y !== b.y) win.setBounds({ ...b, x, y }, false);
  }

  beginDrag(win, point) {
    if (win.isDestroyed() || !point) return;
    this.drag = { win, start: { x: Number(point.x) || 0, y: Number(point.y) || 0 }, bounds: win.getBounds() };
  }

  dragTo(point) {
    const d = this.drag;
    if (!d || d.win.isDestroyed() || !point) return;
    const x = Math.round(d.bounds.x + (Number(point.x) - d.start.x));
    const y = Math.round(d.bounds.y + (Number(point.y) - d.start.y));
    d.win.setBounds({ x, y, width: d.bounds.width, height: d.bounds.height }, false);
  }

  endDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d || d.win.isDestroyed()) return;
    this.snapIfNeeded(d.win);
    const id = this.idOf(d.win);
    if (id) this.layout.set(id, d.win.getBounds());
  }

  destroy() {
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
    this.layout.flush();
  }
}

module.exports = { WindowManager, LayoutStore };

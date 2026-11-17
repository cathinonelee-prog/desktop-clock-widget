'use strict';

const { BrowserWindow, screen } = require('electron');
const path = require('node:path');

const GAP = 8;
const DEFAULT_SIZE = { width: 420, height: 400 };

/**
 * 日历浮层：独立的无边框透明窗口，锚定在某个时钟窗口旁边。
 * 不抢焦点（hover 触发时抢焦点会打断用户正在做的事），因此用「鼠标移出」来模拟失焦隐藏。
 */
class CalendarWindow {
  constructor({ config, rootDir, windowManager, log }) {
    this.config = config;
    this.rootDir = rootDir;
    this.windowManager = windowManager;
    this.log = log;
    this.win = null;
    this.size = { ...DEFAULT_SIZE };
    this.anchorId = null;
    this.hideTimer = null;
    this.visible = false;
    this.hideFinishTimer = null;
    this.panelRect = null; // 可见面板相对窗口的位置（不含透明留白）
  }

  get cfg() {
    return this.config.get().calendar;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const cfg = this.config.get();
    this.win = new BrowserWindow({
      width: this.size.width,
      height: this.size.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      acceptFirstMouse: true,
      alwaysOnTop: cfg.window.layer === 'alwaysOnTop',
      webPreferences: {
        preload: path.join(this.rootDir, 'src', 'preload', 'calendar.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });

    this.win.setMenuBarVisibility(false);
    if (cfg.window.layer === 'alwaysOnTop') this.win.setAlwaysOnTop(true, 'floating');
    this.win.loadURL('app://clock/renderer/calendar.html');
    this.win.webContents.on('console-message', (event) => this.log?.(`[calendar] ${event.message}`));
    this.win.on('closed', () => {
      this.win = null;
      this.visible = false;
    });
    return this.win;
  }

  isVisible() {
    return Boolean(this.win && !this.win.isDestroyed() && this.visible);
  }

  /** 可见面板在屏幕上的矩形（用于悬浮命中判断，排除窗口四周的透明留白） */
  hitRect() {
    if (!this.win || this.win.isDestroyed() || !this.visible) return null;
    const b = this.win.getBounds();
    const r = this.panelRect;
    if (!r) return { x: b.x, y: b.y, width: b.width, height: b.height };
    return { x: b.x + r.x, y: b.y + r.y, width: r.width, height: r.height };
  }

  setPanelRect(rect) {
    if (!rect) return;
    this.panelRect = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  /** 透明窗口上 setOpacity 不生效，改成让渲染进程做 CSS 透明度过渡 */
  sendOpacity(value, duration = 150) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('calendar:opacity', { value, duration });
  }

  applyLook() {
    if (!this.win || this.win.isDestroyed()) return;
    const cfg = this.config.get();
    this.win.setAlwaysOnTop(cfg.window.layer === 'alwaysOnTop', 'floating');
  }

  show(instanceId) {
    if (!this.cfg.enabled) return;
    const win = this.ensure();
    if (instanceId) this.anchorId = instanceId;
    this.applyLook();
    this.position();

    clearTimeout(this.hideFinishTimer);
    this.hideFinishTimer = null;

    if (!this.visible) {
      this.sendOpacity(0, 0);
      win.showInactive();
      this.visible = true;
      setTimeout(() => this.sendOpacity(1, 150), 20);
    } else {
      this.sendOpacity(1, 120);
    }

    win.webContents.send('calendar:opened', { at: Date.now() });
    this.log?.(`calendar shown anchor=${this.anchorId} size=${this.size.width}x${this.size.height}`);
  }

  hide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (!this.win || this.win.isDestroyed() || !this.visible) return;
    this.log?.('calendar hidden');
    this.sendOpacity(0, 140);
    clearTimeout(this.hideFinishTimer);
    this.hideFinishTimer = setTimeout(() => {
      this.hideFinishTimer = null;
      if (this.win && !this.win.isDestroyed()) {
        this.win.hide();
        this.sendOpacity(1, 0);
      }
      this.visible = false;
    }, 170);
    if (this.hideFinishTimer.unref) this.hideFinishTimer.unref();
  }

  toggle(instanceId) {
    if (this.isVisible()) this.hide();
    else this.show(instanceId);
  }

  /** 自动隐藏：鼠标离开后延迟一点点，留出移动到日历上的时间 */
  scheduleHide(delay) {
    if (this.cfg.hideMode !== 'auto') return;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), Math.max(100, delay ?? this.cfg.hideDelayMs ?? 800));
    if (this.hideTimer.unref) this.hideTimer.unref();
  }

  cancelHide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  setSize(size) {
    if (!size) return;
    const width = Math.max(260, Math.min(1200, Math.round(size.width)));
    const height = Math.max(180, Math.min(1000, Math.round(size.height)));
    if (width === this.size.width && height === this.size.height) return;
    this.size = { width, height };
    if (this.isVisible()) this.position();
  }

  anchorBounds() {
    const win = this.anchorId ? this.windowManager?.windowFor(this.anchorId) : null;
    if (win && !win.isDestroyed()) return win.getBounds();
    return null;
  }

  /** 自动选边：优先下方，放不下就上方，再不行左右 */
  position() {
    if (!this.win || this.win.isDestroyed()) return;
    const anchor = this.anchorBounds();
    const display = anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay();
    const area = display.workArea;
    const { width, height } = this.size;
    const clampX = (x) => Math.min(Math.max(area.x + 4, x), area.x + area.width - width - 4);
    const clampY = (y) => Math.min(Math.max(area.y + 4, y), area.y + area.height - height - 4);

    const base = anchor || area;
    const below = { x: clampX(base.x), y: base.y + base.height + GAP };
    const above = { x: clampX(base.x), y: base.y - height - GAP };
    const right = { x: base.x + base.width + GAP, y: clampY(base.y) };
    const left = { x: base.x - width - GAP, y: clampY(base.y) };

    const fitsV = (p) => p.y >= area.y && p.y + height <= area.y + area.height;
    const fitsH = (p) => p.x >= area.x && p.x + width <= area.x + area.width;

    let pos = below;
    if (fitsV(below)) pos = below;
    else if (fitsV(above)) pos = above;
    else if (fitsH(right)) pos = right;
    else if (fitsH(left)) pos = left;

    this.win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width, height }, false);
  }

  destroy() {
    clearTimeout(this.hideTimer);
    clearTimeout(this.hideFinishTimer);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.visible = false;
  }
}

module.exports = { CalendarWindow };


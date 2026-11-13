'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 显示模式（与 renderer/lib/presets.mjs 保持一致） */
const PRESETS = ['minimal', 'standard', 'full', 'lunar', 'single'];

const DEFAULT_CONFIG = {
  version: 1,
  clock: {
    source: 'ntp', // ntp | system
    servers: ['ntp.aliyun.com', 'time.windows.com', 'cn.pool.ntp.org', 'pool.ntp.org'],
    httpFallback: true,
    httpUrls: ['https://www.baidu.com', 'https://www.taobao.com'],
    intervalMin: 15,
    timeoutMs: 2500,
    syncOnStart: true,
  },
  time: {
    timeZone: 'auto', // 'auto' = 跟随系统时区，其它为 IANA 时区
    hour12: false,
    showSeconds: true,
    showYear: false,
  },
  content: {
    preset: 'full',
    parts: {
      date: true,
      weekday: true,
      seconds: true,
      lunar: true,
      term: true,
      holiday: true,
      countdown: false,
      zone: false,
      ganzhi: false,
    },
  },
  look: {
    theme: 'auto', // auto | dark | light
    accent: '#5eead4',
    panelOpacity: 0.42,
    fontWeight: 300,
    scale: 1,
    radius: 22,
    textShadow: true,
    fontFamily: 'default',
  },
  window: {
    layer: 'alwaysOnTop', // alwaysOnTop | desktop
    clickThrough: false,
    locked: false,
    snapToEdges: true,
    margin: 28,
  },
  behavior: {
    autostart: false,
    startHidden: false,
    lowMemory: false, // 关闭 GPU 加速，省掉 GPU 进程的内存（重启生效）
  },
  update: {
    autoCheck: true,
    feed: '', // 留空 = 使用内置的 GitHub Releases 地址；仅测试时覆盖
  },
  hotkeys: {
    toggle: 'Control+Alt+T',
    sync: 'Control+Alt+N',
  },
  instances: [
    {
      id: 'main',
      name: '主时钟',
      displayId: 'auto',
      preset: null, // null = 跟随全局显示模式
      bounds: null,
      hidden: false,
    },
  ],
};

const LIMITS = {
  intervalMin: [1, 1440],
  timeoutMs: [500, 20000],
  panelOpacity: [0.05, 1],
  scale: [0.6, 3],
  radius: [0, 48],
  fontWeight: [100, 900],
  margin: [0, 400],
};

const clamp = (v, [min, max], fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const clone = (v) => JSON.parse(JSON.stringify(v));

function deepMerge(base, patch) {
  if (!isObject(patch)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function normalizeAccent(value) {
  const s = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : DEFAULT_CONFIG.look.accent;
}

function sanitizeServers(list, fallback) {
  if (!Array.isArray(list)) return fallback.slice();
  const cleaned = list
    .map((s) => String(s || '').trim())
    .filter((s) => /^[a-z0-9.-]{3,253}$/i.test(s))
    .slice(0, 8);
  return cleaned.length ? cleaned : fallback.slice();
}

function sanitizeUrls(list, fallback) {
  if (!Array.isArray(list)) return fallback.slice();
  const cleaned = list
    .map((s) => String(s || '').trim())
    .filter((s) => /^https?:\/\/[^\s]+$/i.test(s))
    .slice(0, 6);
  return cleaned.length ? cleaned : fallback.slice();
}

function sanitizeBounds(bounds) {
  if (!isObject(bounds)) return null;
  const nums = ['x', 'y', 'width', 'height'].map((k) => Math.round(Number(bounds[k])));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = nums;
  if (width < 80 || height < 40 || width > 4000 || height > 2000) return null;
  return { x, y, width, height };
}

function sanitizeInstances(list) {
  const fallback = clone(DEFAULT_CONFIG.instances);
  if (!Array.isArray(list) || !list.length) return fallback;
  const seen = new Set();
  const out = [];
  for (const raw of list.slice(0, 12)) {
    if (!isObject(raw)) continue;
    let id = String(raw.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
    if (!id || seen.has(id)) id = `i${Date.now().toString(36)}${out.length}`;
    seen.add(id);
    const preset = PRESETS.includes(raw.preset) ? raw.preset : null;
    out.push({
      id,
      name: String(raw.name || '时钟').slice(0, 40),
      displayId: raw.displayId && raw.displayId !== 'auto' ? String(raw.displayId).slice(0, 80) : 'auto',
      preset,
      bounds: sanitizeBounds(raw.bounds),
      hidden: Boolean(raw.hidden),
    });
  }
  return out.length ? out : fallback;
}

/** 把任意（可能被外部改坏的）配置修正为合法配置 */
function sanitize(input) {
  const cfg = deepMerge(clone(DEFAULT_CONFIG), isObject(input) ? input : {});
  const d = DEFAULT_CONFIG;

  cfg.clock.source = cfg.clock.source === 'system' ? 'system' : 'ntp';
  cfg.clock.servers = sanitizeServers(cfg.clock.servers, d.clock.servers);
  cfg.clock.httpUrls = sanitizeUrls(cfg.clock.httpUrls, d.clock.httpUrls);
  cfg.clock.httpFallback = Boolean(cfg.clock.httpFallback);
  cfg.clock.syncOnStart = Boolean(cfg.clock.syncOnStart);
  cfg.clock.intervalMin = clamp(cfg.clock.intervalMin, LIMITS.intervalMin, d.clock.intervalMin);
  cfg.clock.timeoutMs = clamp(cfg.clock.timeoutMs, LIMITS.timeoutMs, d.clock.timeoutMs);

  cfg.time.timeZone = cfg.time.timeZone === 'auto' || isValidTimeZone(cfg.time.timeZone) ? cfg.time.timeZone : 'auto';
  cfg.time.hour12 = Boolean(cfg.time.hour12);
  cfg.time.showSeconds = Boolean(cfg.time.showSeconds);
  cfg.time.showYear = Boolean(cfg.time.showYear);

  cfg.content.preset = PRESETS.includes(cfg.content.preset) ? cfg.content.preset : d.content.preset;
  const parts = { ...d.content.parts };
  for (const key of Object.keys(parts)) parts[key] = Boolean(cfg.content.parts?.[key]);
  cfg.content.parts = parts;

  cfg.look.theme = ['auto', 'dark', 'light'].includes(cfg.look.theme) ? cfg.look.theme : 'auto';
  cfg.look.accent = normalizeAccent(cfg.look.accent);
  cfg.look.panelOpacity = clamp(cfg.look.panelOpacity, LIMITS.panelOpacity, d.look.panelOpacity);
  delete cfg.look.blur; // 旧版本遗留字段：原生材质与透明窗口冲突，已移除
  cfg.look.fontWeight = Math.round(clamp(cfg.look.fontWeight, LIMITS.fontWeight, d.look.fontWeight) / 100) * 100;
  cfg.look.scale = Math.round(clamp(cfg.look.scale, LIMITS.scale, d.look.scale) * 100) / 100;
  cfg.look.radius = Math.round(clamp(cfg.look.radius, LIMITS.radius, d.look.radius));
  cfg.look.textShadow = Boolean(cfg.look.textShadow);
  cfg.look.fontFamily = ['default', 'sans', 'serif', 'mono'].includes(cfg.look.fontFamily) ? cfg.look.fontFamily : 'default';

  cfg.window.layer = cfg.window.layer === 'desktop' ? 'desktop' : 'alwaysOnTop';
  cfg.window.clickThrough = Boolean(cfg.window.clickThrough);
  cfg.window.locked = Boolean(cfg.window.locked);
  cfg.window.snapToEdges = Boolean(cfg.window.snapToEdges);
  cfg.window.margin = Math.round(clamp(cfg.window.margin, LIMITS.margin, d.window.margin));

  cfg.behavior.autostart = Boolean(cfg.behavior.autostart);
  cfg.behavior.startHidden = Boolean(cfg.behavior.startHidden);
  cfg.behavior.lowMemory = Boolean(cfg.behavior.lowMemory);

  cfg.update.autoCheck = Boolean(cfg.update.autoCheck);
  cfg.update.feed = /^https?:\/\//i.test(String(cfg.update.feed || '')) ? String(cfg.update.feed) : '';

  cfg.hotkeys.toggle = typeof cfg.hotkeys.toggle === 'string' ? cfg.hotkeys.toggle : d.hotkeys.toggle;
  cfg.hotkeys.sync = typeof cfg.hotkeys.sync === 'string' ? cfg.hotkeys.sync : d.hotkeys.sync;

  cfg.instances = sanitizeInstances(cfg.instances);
  cfg.version = 1;
  return cfg;
}

class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.listeners = new Set();
    this.saveTimer = null;
    this.data = this.#read();
  }

  #read() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return sanitize(JSON.parse(raw));
    } catch {
      return clone(DEFAULT_CONFIG);
    }
  }

  get() {
    return this.data;
  }

  /** 局部更新（深合并），返回新配置 */
  update(patch) {
    this.data = sanitize(deepMerge(this.data, patch));
    this.#scheduleSave();
    this.#emit();
    return this.data;
  }

  replace(next) {
    this.data = sanitize(next);
    this.#scheduleSave();
    this.#emit();
    return this.data;
  }

  reset() {
    this.data = clone(DEFAULT_CONFIG);
    this.#scheduleSave();
    this.#emit();
    return this.data;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit() {
    for (const fn of this.listeners) {
      try {
        fn(this.data);
      } catch (err) {
        console.error('[config] listener failed', err);
      }
    }
  }

  #scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[config] save failed', err);
    }
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG, PRESETS, sanitize, isValidTimeZone, clone };

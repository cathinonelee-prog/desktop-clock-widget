import { PRESETS, PRESET_IDS, PART_META, presetOf } from './lib/presets.mjs';
import { createClockView } from './lib/view.mjs';
import { createCalendar } from './lib/calendar.mjs';
import { HolidayDb } from './lib/holidays.mjs';
import { zonedParts } from './lib/format.mjs';

const api = window.clockSettings;

const boot = await api.bootstrap();
let config = boot.config;
let layout = boot.layout;
let displays = boot.displays;
let clockState = boot.clock;
const info = boot.info;
const systemTimeZone = info.systemTimeZone;
let failedHotkeys = Array.isArray(info.failedHotkeys) ? info.failedHotkeys.slice() : [];

const calendar = createCalendar(window.Solar);
const holidays = new HolidayDb();
const previewView = createClockView(document.getElementById('preview-host'), { preview: true });

let previewHoliday = null;
let clockAnchor = { now: boot.clock?.now || Date.now(), perf: performance.now() };
const previewNow = () => clockAnchor.now + (performance.now() - clockAnchor.perf);

const SWATCHES = ['#5eead4', '#7dd3fc', '#a5b4fc', '#f0abfc', '#fda4af', '#fbbf24', '#a3e635', '#f8fafc'];
const QUICK_ZONES = [
  ['北京', 'Asia/Shanghai'],
  ['东京', 'Asia/Tokyo'],
  ['新加坡', 'Asia/Singapore'],
  ['伦敦', 'Europe/London'],
  ['纽约', 'America/New_York'],
  ['洛杉矶', 'America/Los_Angeles'],
];
const OUT_FMT = {
  'look.panelOpacity': (v) => `${Math.round(v * 100)}%`,
  'look.scale': (v) => `${Math.round(v * 100)}%`,
  'look.fontWeight': (v) => String(v),
  'look.radius': (v) => `${v}px`,
};

/* ---------------- 通用配置读写 ---------------- */

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setPathValue(path, value) {
  const parts = path.split('.');
  const patch = {};
  let cursor = patch;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
  return patch;
}

let saveTimer = null;
let pendingPatch = null;

function patchConfig(patch, { immediate = false } = {}) {
  pendingPatch = mergeDeep(pendingPatch || {}, patch);
  clearTimeout(saveTimer);
  const flush = async () => {
    const payload = pendingPatch;
    pendingPatch = null;
    if (!payload) return;
    try {
      config = await api.setConfig(payload);
      syncUI();
      renderPreview();
    } catch (err) {
      toast(`保存失败：${err.message}`, true);
    }
  };
  if (immediate) flush();
  else saveTimer = setTimeout(flush, 90);
}

function mergeDeep(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])
      ? mergeDeep(a[k], v)
      : v;
  }
  return out;
}

const controls = [...document.querySelectorAll('[data-path]')];

function controlValue(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.dataset.type === 'lines') {
    return el.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (el.dataset.scale) return Number(el.value) / Number(el.dataset.scale);
  if (el.type === 'number' || el.type === 'range') return Number(el.value);
  return el.value;
}

function formatOut(path, value) {
  const fn = OUT_FMT[path];
  return fn ? fn(value) : String(value);
}

function updateOut(el) {
  const outId = el.dataset.out;
  if (!outId) return;
  const out = document.getElementById(outId);
  if (!out) return;
  out.textContent = formatOut(el.dataset.path, controlValue(el));
}

function syncUI() {
  for (const el of controls) {
    const value = getPath(config, el.dataset.path);
    if (value === undefined) continue;
    if (el === document.activeElement) continue;
    if (el.type === 'checkbox') {
      el.checked = Boolean(value);
    } else if (el.type === 'radio') {
      el.checked = String(value) === el.value;
      const card = el.closest('.layer-card');
      if (card) card.classList.toggle('is-active', el.checked);
    } else if (el.dataset.type === 'lines') {
      const text = Array.isArray(value) ? value.join('\n') : '';
      if (el.value !== text) el.value = text;
    } else if (el.type === 'range' && el.dataset.scale) {
      // 存储值是 0~1 之类的小数，滑块用 0~100 的整数
      const shown = String(Math.round(Number(value) * Number(el.dataset.scale)));
      if (el.value !== shown) el.value = shown;
    } else if (String(value) !== String(el.value)) {
      el.value = value;
    }
    updateOut(el);
  }
  syncTimeZoneUI();
}

for (const el of controls) {
  const isRange = el.type === 'range';
  const eventName = el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT' || el.type === 'number'
    ? 'change'
    : isRange
      ? 'input'
      : 'change';
  el.addEventListener(eventName, () => {
    patchConfig(setPathValue(el.dataset.path, controlValue(el)), { immediate: !isRange });
    updateOut(el);
  });
  if (isRange) {
    el.addEventListener('input', () => {
      updateOut(el);
      renderPreviewFromControls(el);
    });
  }
}

/* ---------------- 预览 ---------------- */

let previewTimer = null;

function previewConfig() {
  return config;
}

function renderPreview() {
  const now = previewNow();
  const stage = document.querySelector('.preview-stage');
  const host = document.getElementById('preview-host');

  const paint = (cfg) => {
    try {
      previewView.update({
        nowMs: now,
        config: cfg,
        systemTimeZone,
        calendar,
        holidays,
        clockState,
        nextHoliday: previewHoliday,
      });
    } catch (err) {
      console.error('[settings] preview failed', err);
    }
  };

  paint(previewConfig());
  const box = host.getBoundingClientRect();
  const availW = Math.max(160, stage.clientWidth - 56);
  const availH = 132;
  const k = Math.min(1, availW / Math.max(1, box.width), availH / Math.max(1, box.height));
  if (k < 0.965) {
    const scaled = { ...config, look: { ...config.look, scale: Math.max(0.25, config.look.scale * k) } };
    paint(scaled);
  }
}

function renderPreviewFromControls() {
  // 拖动滑块时即时反馈，不必等写盘
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 30);
}

/* ---------------- 时钟状态 ---------------- */

function syncText() {
  const { effectiveSource, status, offsetMs, rttMs, server, syncedAt, error } = clockState || {};
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-text');
  const detail = document.getElementById('sync-detail');
  const cfg = config.clock;

  let kind = 'system';
  let label = '使用本机系统时间';
  if (cfg.source === 'system') {
    kind = 'system';
    label = '本机系统时间';
  } else if (status === 'syncing') {
    kind = 'syncing';
    label = '同步中…';
  } else if (status === 'ok') {
    kind = effectiveSource === 'ntp' ? 'ok' : 'http';
    label = effectiveSource === 'ntp' ? '已对齐网络时间' : '已对齐（HTTPS 兜底）';
  } else if (status === 'error') {
    kind = 'error';
    label = '同步失败';
  } else {
    kind = 'system';
    label = '尚未同步';
  }
  dot.dataset.kind = kind;
  text.textContent = label;

  const rows = [];
  if (cfg.source === 'system') {
    rows.push('时间源：本机系统时间（不做网络校准）');
  } else if (status === 'error') {
    rows.push(`错误：${error || '未知'}`);
    rows.push('已回退到本机系统时间，稍后会自动重试。');
  } else if (syncedAt) {
    const ago = Math.max(0, Math.round((Date.now() - syncedAt) / 1000));
    rows.push(`服务器：${server || '—'}（${effectiveSource === 'ntp' ? 'SNTP' : 'HTTPS'}）`);
    rows.push(`偏差：${offsetMs > 0 ? '+' : ''}${offsetMs} ms　往返：${rttMs ?? '—'} ms`);
    rows.push(`上次同步：${ago < 60 ? `${ago} 秒前` : `${Math.round(ago / 60)} 分钟前`}　间隔：${cfg.intervalMin} 分钟`);
  } else {
    rows.push('等待首次同步…');
  }
  detail.textContent = rows.join('\n');
}

document.getElementById('btn-sync').addEventListener('click', async () => {
  const btn = document.getElementById('btn-sync');
  btn.disabled = true;
  btn.textContent = '同步中…';
  try {
    clockState = await api.syncClock();
    syncText();
    renderPreview();
    toast(clockState.status === 'ok' ? '已与网络时间对齐' : `同步失败：${clockState.error || '未知错误'}`, clockState.status !== 'ok');
  } finally {
    btn.disabled = false;
    btn.textContent = '立即同步';
  }
});

api.onClock((state) => {
  clockState = state;
  clockAnchor = { now: state.now, perf: performance.now() };
  syncText();
  renderPreview();
});

setInterval(() => {
  syncText();
}, 5000);

setInterval(() => {
  if (!document.hidden) renderPreview();
}, 1000);

/* ---------------- 时区 ---------------- */

const tzInput = document.getElementById('tz-input');
const tzToggle = document.getElementById('tz-toggle');
const tzPanel = document.getElementById('tz-panel');
const tzField = document.getElementById('tz-field');
const quickTz = document.getElementById('quick-tz');

/** 所有时区 + 当前 UTC 偏移标签，偏移量只在第一次打开面板时算一次 */
const tzEntries = info.timeZones.map((zone) => ({ zone, label: zone.replace(/_/g, ' '), offset: '' }));
let tzOffsetsReady = false;
let tzFiltered = [];
let tzActive = -1;
let tzTyping = false;
// 打开面板时自身会滚动容器，短时间内忽略滚动事件，避免“刚打开就被自己关掉”
let tzIgnoreScrollUntil = 0;

function ensureTzOffsets() {
  if (tzOffsetsReady) return;
  const now = new Date();
  for (const entry of tzEntries) {
    try {
      const name =
        new Intl.DateTimeFormat('en-US', { timeZone: entry.zone, timeZoneName: 'shortOffset' })
          .formatToParts(now)
          .find((part) => part.type === 'timeZoneName')?.value || '';
      entry.offset = name.replace('GMT', 'UTC');
    } catch {
      entry.offset = '';
    }
  }
  tzOffsetsReady = true;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function tzQuery() {
  // 只有用户真的在输入时才按关键字过滤；单纯展开列表时展示全部
  if (!tzTyping) return '';
  return tzInput.value.trim().toLowerCase().replace(/\s+/g, '_');
}

function renderTzPanel() {
  ensureTzOffsets();
  const q = tzQuery();
  const matched = q ? tzEntries.filter((e) => e.zone.toLowerCase().includes(q)) : tzEntries.slice();
  const cityOf = (zone) => zone.split('/').pop().toLowerCase();
  matched.sort((a, b) => {
    if (q) {
      // 城市名命中的排最前，其次是时区名里包含关键字的
      const rank = (e) => (cityOf(e.zone).startsWith(q) ? 0 : e.zone.toLowerCase().startsWith(q) ? 1 : 2);
      const diff = rank(a) - rank(b);
      if (diff) return diff;
    }
    return a.zone.localeCompare(b.zone);
  });

  tzFiltered = matched;
  if (!matched.length) {
    tzActive = -1;
    tzPanel.innerHTML = '<div class="tz-empty">没有匹配的时区，试试输入城市名，例如 Tokyo</div>';
    return;
  }

  // 未输入关键字时，把当前生效的时区高亮出来
  const current = (config.time.timeZone === 'auto' ? systemTimeZone : config.time.timeZone || '').toLowerCase();
  let activeIndex = q ? 0 : matched.findIndex((e) => e.zone.toLowerCase() === current);
  if (activeIndex < 0) activeIndex = 0;
  tzActive = activeIndex;

  tzPanel.innerHTML = matched
    .map(
      (e, i) =>
        `<div class="tz-option${i === activeIndex ? ' is-active' : ''}" role="option" data-index="${i}" data-zone="${escapeHtml(e.zone)}">` +
        `<span class="tz-zone">${escapeHtml(e.label)}</span><span class="tz-offset">${escapeHtml(e.offset)}</span></div>`,
    )
    .join('');
}

function scrollActiveIntoView() {
  const node = tzPanel.querySelector('.tz-option.is-active');
  if (node) node.scrollIntoView({ block: 'nearest' });
}

function openTzPanel() {
  if (tzField.classList.contains('is-disabled')) return;
  if (!tzPanel.hidden) return;

  renderTzPanel();
  tzIgnoreScrollUntil = Date.now() + 900;

  // 面板朝下打开；下方空间不够时把输入框滚进视口中央，避免被滚动容器裁掉
  const panes = document.querySelector('.panes');
  const paneRect = panes.getBoundingClientRect();
  const rect = tzInput.getBoundingClientRect();
  const below = paneRect.bottom - rect.bottom;
  if (below < 260) {
    tzField.scrollIntoView({ block: 'center' });
    requestAnimationFrame(() => {
      const r = tzInput.getBoundingClientRect();
      tzPanel.style.maxHeight = `${Math.max(140, Math.min(240, paneRect.bottom - r.bottom - 16))}px`;
    });
  } else {
    tzPanel.style.maxHeight = '240px';
  }

  tzPanel.hidden = false;
  tzInput.setAttribute('aria-expanded', 'true');
  const active = tzPanel.querySelector('.tz-option.is-active');
  if (active) active.scrollIntoView({ block: 'center' });
}

function closeTzPanel() {
  if (tzPanel.hidden) return;
  tzPanel.hidden = true;
  tzInput.setAttribute('aria-expanded', 'false');
  tzTyping = false;
}

function setActiveOption(index) {
  const options = [...tzPanel.querySelectorAll('.tz-option')];
  if (!options.length) return;
  const next = Math.max(0, Math.min(options.length - 1, index));
  options.forEach((node, i) => node.classList.toggle('is-active', i === next));
  tzActive = next;
  options[next].scrollIntoView({ block: 'nearest' });
}

function applyTimeZone(zone) {
  if (!info.timeZones.includes(zone)) {
    toast('时区名无效，请从候选列表中选择', true);
    syncTimeZoneUI();
    return;
  }
  patchConfig({ time: { timeZone: zone } }, { immediate: true });
  config = { ...config, time: { ...config.time, timeZone: zone } };
  syncTimeZoneUI();
  renderPreview();
}

for (const [label, zone] of QUICK_ZONES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip-btn';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    closeTzPanel();
    applyTimeZone(zone);
  });
  quickTz.appendChild(btn);
}

tzInput.addEventListener('focus', () => openTzPanel());
tzInput.addEventListener('click', () => openTzPanel());
tzInput.addEventListener('input', () => {
  tzTyping = true;
  renderTzPanel();
  if (tzPanel.hidden) {
    tzPanel.hidden = false;
    tzInput.setAttribute('aria-expanded', 'true');
  }
});
tzInput.addEventListener('blur', () => {
  // 点击面板时不要立刻关掉，交给面板的 mousedown 处理
  setTimeout(() => {
    if (!tzPanel.matches(':hover')) closeTzPanel();
  }, 120);
});

tzInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (tzPanel.hidden) openTzPanel();
    else setActiveOption(tzActive + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!tzPanel.hidden) setActiveOption(tzActive - 1);
  } else if (event.key === 'Enter') {
    if (!tzPanel.hidden && tzFiltered[tzActive]) {
      event.preventDefault();
      applyTimeZone(tzFiltered[tzActive].zone);
      closeTzPanel();
      tzInput.blur();
    }
  } else if (event.key === 'Escape') {
    if (!tzPanel.hidden) {
      event.preventDefault();
      closeTzPanel();
      syncTimeZoneUI();
    }
  } else if (event.key === 'Tab') {
    closeTzPanel();
  }
});

tzToggle.addEventListener('mousedown', (event) => {
  event.preventDefault();
  if (tzPanel.hidden) {
    tzInput.focus();
    openTzPanel();
  } else {
    closeTzPanel();
  }
});

tzPanel.addEventListener('mousedown', (event) => {
  const option = event.target.closest('.tz-option');
  if (!option) return;
  event.preventDefault();
  applyTimeZone(option.dataset.zone);
  closeTzPanel();
});

tzPanel.addEventListener('mousemove', (event) => {
  const option = event.target.closest('.tz-option');
  if (!option) return;
  const index = Number(option.dataset.index);
  if (Number.isFinite(index) && index !== tzActive) setActiveOption(index);
});

tzInput.addEventListener('change', () => {
  const value = tzInput.value.trim();
  if (!value) return;
  if (info.timeZones.includes(value)) {
    applyTimeZone(value);
  } else {
    // 输入了无效时区：收起面板并恢复成当前生效的时区
    closeTzPanel();
    syncTimeZoneUI();
  }
});

// 页面滚动 / 窗口失焦时收起，避免“浮”在内容上方
document.querySelector('.panes').addEventListener(
  'scroll',
  () => {
    if (Date.now() < tzIgnoreScrollUntil) return;
    closeTzPanel();
  },
  { passive: true },
);
window.addEventListener('blur', closeTzPanel);
document.addEventListener('mousedown', (event) => {
  if (tzPanel.hidden) return;
  if (!tzField.contains(event.target)) closeTzPanel();
});

const tzModeRadios = [...document.querySelectorAll('input[name="tzmode"]')];
for (const radio of tzModeRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    closeTzPanel();
    if (radio.value === 'auto') {
      patchConfig({ time: { timeZone: 'auto' } }, { immediate: true });
      config = { ...config, time: { ...config.time, timeZone: 'auto' } };
    } else if (config.time.timeZone === 'auto') {
      patchConfig({ time: { timeZone: systemTimeZone } }, { immediate: true });
      config = { ...config, time: { ...config.time, timeZone: systemTimeZone } };
    }
    syncTimeZoneUI();
    renderPreview();
  });
}

function syncTimeZoneUI() {
  const isAuto = config.time.timeZone === 'auto';
  for (const radio of tzModeRadios) radio.checked = radio.value === (isAuto ? 'auto' : 'custom');
  tzField.classList.toggle('is-disabled', isAuto);
  if (isAuto) closeTzPanel();
  if (!isAuto && tzInput !== document.activeElement) tzInput.value = config.time.timeZone;
  if (isAuto && tzInput !== document.activeElement) tzInput.value = systemTimeZone;
}

/* ---------------- 显示模式 / 元素 ---------------- */

const presetGrid = document.getElementById('preset-grid');
for (const id of PRESET_IDS) {
  const preset = PRESETS[id];
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'preset-card';
  card.dataset.preset = id;
  card.innerHTML = `<span class="preset-name"></span><span class="preset-desc"></span>`;
  card.querySelector('.preset-name').textContent = preset.label;
  card.querySelector('.preset-desc').textContent = preset.desc;
  card.addEventListener('click', () => {
    config = { ...config, content: { ...config.content, preset: id } };
    patchConfig({ content: { preset: id } }, { immediate: true });
    syncPresetCards();
    renderPreview();
  });
  presetGrid.appendChild(card);
}

function syncPresetCards() {
  for (const card of presetGrid.querySelectorAll('.preset-card')) {
    card.classList.toggle('is-active', card.dataset.preset === config.content.preset);
  }
}

const partsGrid = document.getElementById('parts-grid');
for (const part of PART_META) {
  const label = document.createElement('label');
  label.className = 'part-item';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.path = `content.parts.${part.key}`;
  input.checked = Boolean(config.content.parts[part.key]);
  input.addEventListener('change', () => {
    config = { ...config, content: { ...config.content, parts: { ...config.content.parts, [part.key]: input.checked } } };
    patchConfig({ content: { parts: { [part.key]: input.checked } } }, { immediate: true });
    renderPreview();
  });
  const span = document.createElement('span');
  span.textContent = part.label;
  const small = document.createElement('small');
  small.textContent = part.hint;
  label.append(input, span, small);
  partsGrid.appendChild(label);
}

/* ---------------- 颜色 ---------------- */

const swatchBox = document.getElementById('swatches');
for (const color of SWATCHES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'swatch';
  btn.dataset.color = color;
  btn.style.background = color;
  btn.title = color;
  btn.addEventListener('click', () => {
    config = { ...config, look: { ...config.look, accent: color } };
    patchConfig({ look: { accent: color } }, { immediate: true });
    syncSwatches();
    renderPreview();
  });
  swatchBox.appendChild(btn);
}

const customColor = document.createElement('input');
customColor.type = 'color';
customColor.className = 'swatch-custom';
customColor.title = '自定义颜色';
customColor.addEventListener('input', () => {
  config = { ...config, look: { ...config.look, accent: customColor.value } };
  patchConfig({ look: { accent: customColor.value } }, { immediate: true });
  syncSwatches();
  renderPreview();
});
swatchBox.appendChild(customColor);

function syncSwatches() {
  for (const btn of swatchBox.querySelectorAll('.swatch')) {
    btn.classList.toggle('is-active', btn.dataset.color === config.look.accent);
  }
  customColor.value = config.look.accent;
}

/* ---------------- 实例与显示器 ---------------- */

const instanceTable = document.getElementById('instance-table');
const displayListEl = document.getElementById('display-list');

function presetOptions(selected) {
  const opts = [`<option value="">跟随全局（${PRESETS[config.content.preset]?.label || '完整信息'}）</option>`];
  for (const id of PRESET_IDS) {
    opts.push(
      `<option value="${id}"${selected === id ? ' selected' : ''}>${PRESETS[id].label}</option>`,
    );
  }
  return opts.join('');
}

function displayOptions(selected) {
  const opts = ['<option value="auto">自动（主屏）</option>'];
  for (const d of displays) {
    opts.push(`<option value="${d.id}"${String(selected) === String(d.id) ? ' selected' : ''}>${d.label}</option>`);
  }
  return opts.join('');
}

let instanceSignature = '';

async function refreshLayout() {
  try {
    const result = await api.getLayout();
    layout = result.layout;
    displays = result.displays;
  } catch {
    /* 忽略 */
  }
}

function renderInstances() {
  const signature = JSON.stringify(config.instances.map((i) => [i.id, i.name, i.displayId, i.preset, i.hidden]));
  if (signature === instanceSignature) return;
  instanceSignature = signature;

  instanceTable.innerHTML = '';
  for (const inst of config.instances) {
    const row = document.createElement('div');
    row.className = 'inst-row';
    row.dataset.id = inst.id;

    const name = document.createElement('input');
    name.type = 'text';
    name.value = inst.name;
    name.addEventListener('change', () => api.updateInstance(inst.id, { name: name.value.trim() || '时钟' }));

    const display = document.createElement('select');
    display.innerHTML = displayOptions(inst.displayId);
    display.addEventListener('change', async () => {
      await api.updateInstance(inst.id, { displayId: display.value });
      await refreshLayout();
      renderDisplays();
      renderPreview();
    });

    const preset = document.createElement('select');
    preset.innerHTML = presetOptions(inst.preset);
    preset.addEventListener('change', () => api.updateInstance(inst.id, { preset: preset.value || null }));

    const toggle = document.createElement('label');
    toggle.className = 'inst-toggle';
    const hidden = document.createElement('input');
    hidden.type = 'checkbox';
    hidden.checked = Boolean(inst.hidden);
    hidden.addEventListener('change', () => api.updateInstance(inst.id, { hidden: hidden.checked }));
    const hiddenText = document.createElement('span');
    hiddenText.textContent = '隐藏';
    toggle.append(hidden, hiddenText);

    const del = document.createElement('button');
    del.className = 'inst-del';
    del.type = 'button';
    del.title = '删除这个时钟';
    del.textContent = '×';
    del.disabled = config.instances.length <= 1;
    del.addEventListener('click', async () => {
      const res = await api.removeInstance(inst.id);
      if (res?.ok === false) toast('至少保留一个时钟窗口', true);
      instanceSignature = '';
      renderInstances();
    });

    row.append(name, display, preset, toggle, del);
    instanceTable.appendChild(row);
  }
}

function renderDisplays() {
  displayListEl.innerHTML = '';
  for (const d of displays) {
    const row = document.createElement('div');
    row.className = 'display-row';
    const left = document.createElement('span');
    left.textContent = d.label;
    const right = document.createElement('span');
    right.className = 'badge' + (d.primary ? ' primary' : '');
    right.textContent = `${d.workArea.width}×${d.workArea.height} · ${Math.round(d.scaleFactor * 100)}%`;
    row.append(left, right);
    displayListEl.appendChild(row);
  }
}

document.getElementById('btn-add-instance').addEventListener('click', async () => {
  const res = await api.addInstance({ displayId: 'auto' });
  if (res?.instances) {
    config = { ...config, instances: res.instances };
    instanceSignature = '';
    renderInstances();
    toast('已添加时钟窗口');
  }
});

document.getElementById('btn-one-per-display').addEventListener('click', async () => {
  const res = await api.onePerDisplay();
  if (res?.instances) {
    config = { ...config, instances: res.instances };
    await refreshLayout();
    instanceSignature = '';
    renderInstances();
    renderDisplays();
    toast(`已为 ${displays.length} 块屏幕创建时钟`);
  }
});

document.getElementById('btn-reset-layout').addEventListener('click', async () => {
  layout = await api.resetLayout();
  toast('已重置到右下角默认位置');
});

/* ---------------- 导航 ---------------- */

const navItems = [...document.querySelectorAll('.nav-item')];
const panes = [...document.querySelectorAll('.pane')];

function activateTab(name) {
  if (!name) return;
  const item = navItems.find((i) => i.dataset.tab === name);
  if (!item) return;
  for (const other of navItems) other.classList.toggle('is-active', other === item);
  for (const pane of panes) pane.classList.toggle('is-active', pane.dataset.tab === name);
  document.querySelector('.panes').scrollTop = 0;
}

for (const item of navItems) {
  item.addEventListener('click', () => activateTab(item.dataset.tab));
}

const initialTab = new URLSearchParams(location.search).get('tab');
if (initialTab) activateTab(initialTab);
api.onTab((tab) => activateTab(tab));

/* ---------------- 窗口按钮 ---------------- */

document.getElementById('btn-close').addEventListener('click', () => api.close());
document.getElementById('btn-min').addEventListener('click', () => api.minimize());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.close();
});

/* ---------------- 全局快捷键录制 ---------------- */

const hotkeyRenders = [];

function hotkeyValue(name) {
  return (config.hotkeys && config.hotkeys[name]) || '';
}

/** 把 KeyboardEvent 转成 Electron 加速器字符串，例如 Control+Alt+T */
function acceleratorFromEvent(event) {
  const mods = [];
  if (event.ctrlKey) mods.push('Control');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  if (event.metaKey) mods.push('Super');

  let key = null;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) key = event.key.toUpperCase();
  else {
    const map = {
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      ' ': 'Space',
      Enter: 'Return',
      Tab: 'Tab',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Insert: 'Insert',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
    };
    if (map[event.key]) key = map[event.key];
    else if (event.key.length === 1 && /^[\x21-\x7e]$/.test(event.key)) key = event.key;
  }

  if (!key) return null;
  const isFunction = /^F\d{1,2}$/.test(key);
  const isSpecial = ['Up', 'Down', 'Left', 'Right', 'Space', 'Tab', 'Return', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace'].includes(key);
  // 没有修饰键时，只允许功能键或特殊键，避免单个字母变成全局热键
  if (!mods.length && !isFunction && !isSpecial) return null;
  return [...new Set([...mods, key])].join('+');
}

function setupHotkeyField(name) {
  const field = document.querySelector(`.hotkey-field[data-hotkey="${name}"]`);
  if (!field) return;
  const display = field.querySelector('.hotkey-display');
  const clear = field.querySelector('.hotkey-clear');
  let recording = false;

  const render = () => {
    const value = hotkeyValue(name);
    const conflict = Boolean(value) && failedHotkeys.includes(value);
    display.textContent = recording ? '按下组合键…（Esc 取消）' : value || '未设置（点击录制）';
    display.classList.toggle('is-recording', recording);
    display.classList.toggle('is-empty', !value && !recording);
    display.classList.toggle('is-conflict', !recording && conflict);
    display.title = conflict ? '这个快捷键被其他程序占用，建议重新录制' : '点击后按下组合键录制';
    clear.disabled = !value && !recording;
  };

  const stop = () => {
    recording = false;
    render();
  };

  const commit = (value) => {
    patchConfig({ hotkeys: { [name]: value } }, { immediate: true });
    config = { ...config, hotkeys: { ...config.hotkeys, [name]: value } };
    failedHotkeys = failedHotkeys.filter((item) => item !== value);
    stop();
  };

  display.addEventListener('click', () => {
    recording = true;
    render();
    display.focus();
  });

  display.addEventListener('blur', () => {
    if (recording) stop();
  });

  display.addEventListener('keydown', (event) => {
    if (!recording) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        recording = true;
        render();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      stop();
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      commit('');
      return;
    }

    const accelerator = acceleratorFromEvent(event);
    if (!accelerator) return; // 只按了修饰键，继续等待

    const otherName = name === 'toggle' ? 'sync' : 'toggle';
    if (hotkeyValue(otherName).toLowerCase() === accelerator.toLowerCase()) {
      toast('这个组合已经被另一个动作占用', true);
      return;
    }
    commit(accelerator);
  });

  clear.addEventListener('click', () => {
    if (recording) stop();
    commit('');
  });

  hotkeyRenders.push(render);
  render();
}

setupHotkeyField('toggle');
setupHotkeyField('sync');

api.onHotkeyFailed?.((list) => {
  if (!Array.isArray(list) || !list.length) return;
  failedHotkeys = list.slice();
  for (const renderHotkey of hotkeyRenders) renderHotkey();
  toast(`快捷键 ${list.join('、')} 注册失败，可能被其他程序占用，请重新录制`, true);
});

/* ---------------- 关于 ---------------- */

document.getElementById('ver').textContent = `v${info.version}`;
document.getElementById('about-version').textContent = `${info.version} · Electron ${info.electron} · Chromium ${info.chrome}`;
document.getElementById('about-runtime').textContent = `${info.platform} · ${info.systemTimeZone}`;
document.getElementById('about-data').textContent = info.userData;

document.getElementById('btn-open-data').addEventListener('click', () => api.openDataFolder());
document.getElementById('btn-reset-config').addEventListener('click', async () => {
  config = await api.resetConfig();
  instanceSignature = '';
  syncAll();
  toast('已恢复默认设置');
});

document.getElementById('btn-relaunch').addEventListener('click', () => api.relaunch());
const lowMemoryCheckbox = document.querySelector('[data-path="behavior.lowMemory"]');
lowMemoryCheckbox?.addEventListener('change', () => {
  toast(lowMemoryCheckbox.checked ? '已开启低内存模式，重启后生效' : '已关闭低内存模式，重启后生效');
});

/* ---------------- 版本更新 ---------------- */

const updateTitle = document.getElementById('update-title');
const updateSub = document.getElementById('update-sub');
const btnCheckUpdate = document.getElementById('btn-check-update');
const btnInstallUpdate = document.getElementById('btn-install-update');
const updateProgress = document.getElementById('update-progress');
const updateBar = document.getElementById('update-bar');
const updateNotesWrap = document.getElementById('update-notes-wrap');
const updateNotes = document.getElementById('update-notes');
let latestState = null;

/** Release 说明是 Markdown，更新卡片里用纯文本展示，去掉标记符号 */
function formatReleaseNotes(markdown) {
  return String(markdown)
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '· ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderUpdate(state) {
  if (!state) return;
  latestState = state;

  updateTitle.textContent = `当前版本 v${state.currentVersion}`;
  updateProgress.hidden = state.status !== 'downloading';
  updateBar.style.width = `${state.progress || 0}%`;
  btnCheckUpdate.disabled = state.status === 'checking' || state.status === 'downloading' || state.status === 'applying';
  btnCheckUpdate.textContent = state.status === 'checking' ? '检查中…' : '检查更新';

  const notes = (state.notes || '').trim();
  updateNotesWrap.hidden = !notes;
  updateNotes.textContent = formatReleaseNotes(notes);

  btnInstallUpdate.hidden = true;
  btnInstallUpdate.disabled = false;

  switch (state.status) {
    case 'idle':
      updateSub.textContent = '尚未检查更新';
      break;
    case 'checking':
      updateSub.textContent = '正在检查新版本…';
      break;
    case 'latest':
      updateSub.textContent = `已是最新版本（v${state.latestVersion}）`;
      break;
    case 'available':
      updateSub.textContent = `发现新版本 v${state.latestVersion}，大小约 ${(state.assetSize / 1048576).toFixed(0)} MB`;
      btnInstallUpdate.hidden = false;
      btnInstallUpdate.textContent = '下载并安装';
      break;
    case 'downloading':
      updateSub.textContent = `正在下载新版本 v${state.latestVersion}… ${state.progress || 0}%`;
      break;
    case 'ready':
      updateSub.textContent = `v${state.latestVersion} 已下载，重启后完成安装`;
      btnInstallUpdate.hidden = false;
      btnInstallUpdate.textContent = '重启并安装';
      break;
    case 'applying':
      updateSub.textContent = '正在替换程序文件，稍后自动重启…';
      break;
    case 'error':
      updateSub.textContent = `检查失败：${state.error || '未知错误'}`;
      btnInstallUpdate.hidden = false;
      btnInstallUpdate.textContent = '重试';
      break;
    default:
      updateSub.textContent = state.status;
  }
}

btnCheckUpdate.addEventListener('click', async () => {
  try {
    renderUpdate(await api.checkUpdate());
  } catch (err) {
    toast(`检查更新失败：${err.message}`, true);
  }
});

btnInstallUpdate.addEventListener('click', async () => {
  try {
    if (latestState?.status === 'ready') {
      if (!window.confirm('即将关闭程序并安装更新，完成后会自动重新启动。继续吗？')) return;
      const result = await api.applyUpdate();
      if (!result?.ok) toast(result?.error || '安装失败', true);
      return;
    }
    btnInstallUpdate.disabled = true;
    btnInstallUpdate.textContent = '下载中…';
    renderUpdate(await api.downloadUpdate());
  } catch (err) {
    toast(`下载失败：${err.message}`, true);
  } finally {
    btnInstallUpdate.disabled = false;
  }
});

api.onUpdate(renderUpdate);
api.updateState().then(renderUpdate).catch(() => {});

/* ---------------- 提示 ---------------- */

let toastTimer = null;
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-show'), 2400);
}

/* ---------------- 初始化 ---------------- */

function syncAll() {
  syncUI();
  syncPresetCards();
  for (const input of partsGrid.querySelectorAll('input[data-path]')) {
    const key = input.dataset.path.split('.').pop();
    input.checked = Boolean(config.content.parts[key]);
  }
  syncSwatches();
  for (const renderHotkey of hotkeyRenders) renderHotkey();
  syncTimeZoneUI();
  syncText();
  renderInstances();
  renderDisplays();
  renderPreview();
}

api.onConfig((payload) => {
  if (!payload) return;
  config = payload.config;
  if (payload.layout) layout = payload.layout;
  if (payload.displays) displays = payload.displays;
  syncAll();
});

window.addEventListener('resize', () => renderPreview());

syncAll();
setTimeout(renderPreview, 60);

// 预取假日数据用于预览
(async () => {
  const now = new Date();
  await holidays.ensure(now.getFullYear());
  previewHoliday = await holidays.nextHoliday({
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    d: now.getDate(),
  });
  renderPreview();
})();


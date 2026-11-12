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
const tzField = document.getElementById('tz-field');
const tzList = document.getElementById('tz-list');
const quickTz = document.getElementById('quick-tz');

for (const zone of info.timeZones) {
  const option = document.createElement('option');
  option.value = zone;
  tzList.appendChild(option);
}

for (const [label, zone] of QUICK_ZONES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip-btn';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    patchConfig({ time: { timeZone: zone } }, { immediate: true });
    config = { ...config, time: { ...config.time, timeZone: zone } };
    syncTimeZoneUI();
    renderPreview();
  });
  quickTz.appendChild(btn);
}

tzInput.addEventListener('change', () => {
  const value = tzInput.value.trim();
  if (!value) return;
  if (!info.timeZones.includes(value)) {
    toast('时区名无效，请从候选列表中选择', true);
    syncTimeZoneUI();
    return;
  }
  patchConfig({ time: { timeZone: value } }, { immediate: true });
  config = { ...config, time: { ...config.time, timeZone: value } };
  syncTimeZoneUI();
  renderPreview();
});

const tzModeRadios = [...document.querySelectorAll('input[name="tzmode"]')];
for (const radio of tzModeRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
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

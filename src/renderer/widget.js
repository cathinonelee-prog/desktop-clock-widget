import { createClockView } from './lib/view.mjs';
import { createCalendar } from './lib/calendar.mjs';
import { HolidayDb } from './lib/holidays.mjs';
import { partsOf } from './lib/presets.mjs';

const api = window.clockWidget;

window.addEventListener('error', (e) => console.error('[widget] error', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[widget] rejection', e.reason?.stack || e.reason));

const boot = await api.bootstrap();
let config = boot.config;
const systemTimeZone = boot.info.systemTimeZone;

/** 当前窗口对应的实例（用于单独指定显示模式） */
function instanceOf(cfg) {
  return cfg.instances.find((i) => i.id === api.instanceId) || null;
}

/** 把实例级设置合并进全局配置，供视图渲染 */
function effectiveConfig(cfg) {
  const inst = instanceOf(cfg);
  if (!inst?.preset) return cfg;
  return { ...cfg, content: { ...cfg.content, preset: inst.preset } };
}

const calendar = createCalendar(window.Solar);
const holidays = new HolidayDb();
const view = createClockView(document.body, { preview: false });

let clockState = boot.clock;
let anchor = { serverMs: clockState.now, perf: performance.now() };
let nextHoliday = null;
let nextHolidayFor = null;
let timer = null;
let lastSize = { width: 0, height: 0 };

const nowMs = () => anchor.serverMs + (performance.now() - anchor.perf);

function setAnchor(state) {
  if (!state) return;
  clockState = state;
  anchor = { serverMs: state.now, perf: performance.now() };
}

function applyBodyState() {
  document.body.classList.toggle('is-locked', Boolean(config.window.locked));
  document.body.classList.toggle('is-click-through', Boolean(config.window.clickThrough));
}

async function refreshNextHoliday(ymd) {
  if (!ymd || ymd === nextHolidayFor) return;
  nextHolidayFor = ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  try {
    await holidays.ensure(y);
    const result = await holidays.nextHoliday({ y, m, d });
    if (nextHolidayFor === ymd) {
      nextHoliday = result;
      render();
    }
  } catch {
    nextHoliday = null;
  }
}

function render() {
  const cfg = effectiveConfig(config);
  let ymd = null;
  try {
    const result = view.update({
      nowMs: nowMs(),
      config: cfg,
      systemTimeZone,
      calendar,
      holidays,
      clockState,
      nextHoliday,
    });
    ymd = result?.ymd || null;
  } catch (err) {
    console.error('[widget] render failed', err);
  }
  if (partsOf(cfg).countdown && ymd) refreshNextHoliday(ymd);
}

function pushSize(force = false) {
  const size = view.measure();
  if (!size.width || !size.height) return;
  if (!force && Math.abs(size.width - lastSize.width) < 2 && Math.abs(size.height - lastSize.height) < 2) return;
  lastSize = size;
  api.resize({ width: size.width, height: size.height });
}

function tick() {
  clearTimeout(timer);
  render();
  const t = nowMs();
  const delay = 1000 - (((t % 1000) + 1000) % 1000) + 8;
  timer = setTimeout(tick, Math.max(30, delay));
}

function applyConfig(next) {
  config = next;
  applyBodyState();
  render();
  pushSize();
}

applyBodyState();
render();
pushSize(true);
tick();

// 字体加载完成后宽度可能变化，重新测一次
if (document.fonts?.ready) {
  document.fonts.ready.then(() => {
    render();
    pushSize();
  });
}

// 内容尺寸兜底监听（例如系统字体替换、时区名变化）
let resizeTimer = null;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => pushSize(), 120);
}).observe(view.element);

api.onConfig((payload) => {
  if (payload?.config) applyConfig(payload.config);
});

api.onClock((state) => {
  setAnchor(state);
  render();
  pushSize();
});

// 定期向主进程校准一次（防止 performance.now 与主进程计时漂移）
setInterval(async () => {
  try {
    const state = await api.getClock();
    setAnchor(state);
  } catch {
    /* 忽略 */
  }
}, 60_000);

document.body.addEventListener('clock-contextmenu', () => api.contextMenu());
document.body.addEventListener('clock-open-settings', () => api.openSettings());

// —— 拖动（跨屏可用） ——
const panelEl = view.element;
let drag = null;

panelEl.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || config.window.locked) return;
  drag = { x: event.screenX, y: event.screenY, pending: null, raf: 0 };
  document.body.classList.add('is-dragging');
  api.dragStart({ x: event.screenX, y: event.screenY });
  try {
    panelEl.setPointerCapture(event.pointerId);
  } catch {
    /* 忽略 */
  }
});

window.addEventListener('pointermove', (event) => {
  if (!drag) return;
  drag.pending = { x: event.screenX, y: event.screenY };
  if (drag.raf) return;
  drag.raf = requestAnimationFrame(() => {
    if (!drag) return;
    drag.raf = 0;
    if (drag.pending) api.dragMove(drag.pending);
  });
});

function endDrag() {
  if (!drag) return;
  drag = null;
  document.body.classList.remove('is-dragging');
  api.dragEnd();
}

window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);

// Ctrl + 滚轮：快速缩放（先本地预览，停手后写回配置）
let wheelTimer = null;
panelEl.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const next = Math.min(
      3,
      Math.max(0.6, Math.round((config.look.scale + (event.deltaY > 0 ? -0.05 : 0.05)) * 100) / 100),
    );
    config = { ...config, look: { ...config.look, scale: next } };
    render();
    pushSize();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => api.setConfig({ look: { scale: next } }), 320);
  },
  { passive: false },
);

import { createCalendar } from './lib/calendar.mjs';
import { HolidayDb } from './lib/holidays.mjs';
import { zonedParts } from './lib/format.mjs';
import { FONT_STACKS } from './lib/view.mjs';

const api = window.clockCalendar;

const boot = await api.bootstrap();
let config = boot.config;
const systemTimeZone = boot.info.systemTimeZone;
const calendar = createCalendar(window.Solar);
const holidays = new HolidayDb();

const panel = document.getElementById('cal-panel');
const monthsEl = document.getElementById('cal-months');
const titleEl = document.getElementById('cal-title');

let clockMs = boot.clock?.now || Date.now();
let anchorDate = null; // { y, m }
let lastRenderedYmd = '';

const WEEK_LABELS_MON = ['一', '二', '三', '四', '五', '六', '日'];
const WEEK_LABELS_SUN = ['日', '一', '二', '三', '四', '五', '六'];

function currentTimeZone() {
  return config.time.timeZone === 'auto' ? systemTimeZone : config.time.timeZone;
}

function todayParts() {
  const p = zonedParts(clockMs, currentTimeZone());
  return { y: p.y, m: p.mo, d: p.d };
}

function viewStart() {
  if (!anchorDate) {
    const t = todayParts();
    anchorDate = { y: t.y, m: t.m };
  }
  return { ...anchorDate };
}

function addMonths({ y, m }, delta) {
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

function resolveTheme() {
  if (config.look.theme === 'dark' || config.look.theme === 'light') return config.look.theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyLook() {
  panel.dataset.theme = resolveTheme();
  panel.dataset.highlightWeekend = config.calendar.highlightWeekend ? 'on' : 'off';
  panel.style.setProperty('--scale', String(config.look.scale));
  panel.style.setProperty('--accent', config.look.accent);
  panel.style.setProperty('--panel-a', String(config.look.panelOpacity));
  panel.style.setProperty('--radius', `${Math.round(config.look.radius * config.look.scale)}px`);
  panel.style.setProperty('--font', FONT_STACKS[config.look.fontFamily] || FONT_STACKS.default);
  document.body.classList.toggle('is-light', resolveTheme() === 'light');
}

/** 某月 42 个格子（6 行），包含前后月补白 */
function monthCells(y, m) {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const firstDow = first.getUTCDay();
  const offset = config.calendar.weekStart === 'sun' ? firstDow : (firstDow + 6) % 7;
  const cells = [];
  for (let i = offset; i > 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1, 1 - i));
    cells.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), adjacent: true });
  }
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= daysInMonth; d += 1) cells.push({ y, m, d, adjacent: false });
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    const nd = new Date(Date.UTC(last.y, last.m - 1, last.d + 1));
    cells.push({ y: nd.getUTCFullYear(), m: nd.getUTCMonth() + 1, d: nd.getUTCDate(), adjacent: true });
  }
  return cells;
}

function weekdayOf({ y, m, d }) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function shortLunar(info) {
  // 农历日：初一、初九、十七、廿三、三十
  return info.lunarDayText || '';
}

function cellNode(cell, today) {
  const node = document.createElement('div');
  const weekday = weekdayOf(cell);
  const isWeekend = weekday === 0 || weekday === 6;
  const isToday = cell.y === today.y && cell.m === today.m && cell.d === today.d;

  if (cell.adjacent && !config.calendar.showAdjacent) {
    node.className = 'cal-cell is-empty';
    return node;
  }

  node.className = 'cal-cell';
  if (cell.adjacent) node.classList.add('is-adjacent');
  if (isWeekend) node.classList.add('is-weekend');
  if (isToday) node.classList.add('is-today');

  const info = calendar.info({ y: cell.y, m: cell.m, d: cell.d });
  const holiday = holidays.info(cell.y, cell.m, cell.d);

  if (holiday && config.calendar.showHolidays) {
    if (holiday.type === 'holiday') node.classList.add('is-holiday');
    if (holiday.type === 'inLieu') node.classList.add('is-holiday');
    if (holiday.type === 'workday') node.classList.add('is-workday');
  }

  const day = document.createElement('span');
  day.className = 'cal-day';
  day.textContent = String(cell.d);
  node.appendChild(day);

  let sub = '';
  let subClass = 'cal-sub';
  if (config.calendar.showTerms && info.termToday) {
    sub = info.termToday;
    subClass += ' is-term';
  } else if (config.calendar.showLunar) {
    sub = info.festivals?.[0] || shortLunar(info);
  }

  if (sub) {
    const subEl = document.createElement('span');
    subEl.className = subClass;
    subEl.textContent = sub;
    node.appendChild(subEl);
  }

  if (config.calendar.showHolidays && holiday) {
    const tag = document.createElement('span');
    tag.className = 'cal-tag';
    if (holiday.type === 'workday') {
      tag.classList.add('is-workday');
      tag.textContent = '班';
    } else {
      tag.classList.add('is-holiday');
      tag.textContent = '休';
    }
    node.appendChild(tag);
  }

  return node;
}

function buildMonthBlock({ y, m }, today, showHead) {
  const block = document.createElement('div');
  block.className = 'cal-month';

  if (showHead) {
    const head = document.createElement('div');
    head.className = 'cal-month-head';
    const name = document.createElement('span');
    name.className = 'cal-month-name';
    name.textContent = `${m} 月`;
    const lunarYear = calendar.info({ y, m, d: 15 });
    const sub = document.createElement('span');
    sub.textContent = `${lunarYear.ganzhi} · ${lunarYear.zodiac}年`;
    head.append(name, sub);
    block.appendChild(head);
  }

  const week = document.createElement('div');
  week.className = 'cal-week';
  const labels = config.calendar.weekStart === 'sun' ? WEEK_LABELS_SUN : WEEK_LABELS_MON;
  for (const label of labels) {
    const el = document.createElement('span');
    el.textContent = label;
    if (label === '六' || label === '日') el.classList.add('is-weekend');
    week.appendChild(el);
  }

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  for (const cell of monthCells(y, m)) grid.appendChild(cellNode(cell, today));

  block.append(week, grid);
  return block;
}

async function render() {
  const start = viewStart();
  const months = [];
  const count = config.calendar.months === 2 ? 2 : 1;
  for (let i = 0; i < count; i += 1) months.push(addMonths(start, i));

  await Promise.all(months.map((item) => holidays.ensure(item.y)));

  const today = todayParts();
  applyLook();

  titleEl.textContent =
    count === 2
      ? `${months[0].y} 年 ${months[0].m}–${months[1].m} 月`
      : `${start.y} 年 ${start.m} 月`;

  const showHead = count === 2;
  monthsEl.replaceChildren(...months.map((item) => buildMonthBlock(item, today, showHead)));
  lastRenderedYmd = `${today.y}-${today.m}-${today.d}`;

  const measure = () => {
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(document.body);
    const width = Math.ceil(rect.width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)) + 4;
    const height = Math.ceil(rect.height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)) + 4;
    api.resize({ width, height });
  };
  requestAnimationFrame(() => {
    measure();
    // 字体/网格排版稳定后再量一次，避免窗口比内容窄一点导致右侧被裁
    setTimeout(measure, 120);
  });
}

document.getElementById('cal-prev').addEventListener('click', () => {
  anchorDate = addMonths(viewStart(), -1);
  render();
});
document.getElementById('cal-next').addEventListener('click', () => {
  anchorDate = addMonths(viewStart(), 1);
  render();
});
document.getElementById('cal-today').addEventListener('click', () => {
  const t = todayParts();
  anchorDate = { y: t.y, m: t.m };
  render();
});
document.getElementById('cal-close').addEventListener('click', () => api.close());

document.body.addEventListener('pointerenter', () => api.pointerEnter());
document.body.addEventListener('pointerleave', () => api.pointerLeave());

api.onConfig((payload) => {
  if (!payload?.config) return;
  config = payload.config;
  if (config.calendar.months === 1) {
    const t = todayParts();
    anchorDate = { y: t.y, m: t.m };
  }
  render();
});

api.onClock((state) => {
  clockMs = state.now;
  const p = zonedParts(clockMs, currentTimeZone());
  const ymd = `${p.y}-${p.mo}-${p.d}`;
  if (ymd !== lastRenderedYmd) render();
});

render();

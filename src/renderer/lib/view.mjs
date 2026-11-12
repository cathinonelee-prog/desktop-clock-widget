/** 时钟面板视图：负责把「配置 + 当前时间」渲染成 DOM，供悬浮窗与设置预览共用 */

import { PRESETS, presetOf, partsOf } from './presets.mjs';
import { zonedParts, formatTime, offsetLabel } from './format.mjs';

const TIME_SIZE = { xl: 66, lg: 52, md: 36, sm: 21 };
const FONT_STACKS = {
  default: `'Segoe UI Variable Display', 'Segoe UI', 'Bahnschrift', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif`,
  sans: `'Microsoft YaHei UI', 'Segoe UI', system-ui, sans-serif`,
  serif: `'Source Han Serif SC', 'Songti SC', 'SimSun', serif`,
  mono: `'Cascadia Mono', 'Consolas', 'Microsoft YaHei UI', monospace`,
};

const HTML = `
<div class="panel">
  <span class="sheen" aria-hidden="true"></span>
  <div class="row r-time">
    <span class="t-main"></span><span class="t-sec"></span>
    <span class="zone"></span>
  </div>
  <div class="row r-lunar">
    <span class="l-main"></span>
    <span class="l-sub"></span>
  </div>
  <div class="row r-date">
    <span class="d-date"></span>
    <span class="d-week"></span>
  </div>
  <div class="row r-info">
    <span class="chip c-lunar"></span>
    <span class="chip c-term"></span>
    <span class="chip c-fest"></span>
    <span class="chip c-count"></span>
    <span class="chip c-ganzhi"></span>
  </div>
  <div class="row r-single"></div>
  <span class="dot" aria-hidden="true"></span>
</div>`;

function setText(el, text) {
  if (el.__text === text) return;
  el.__text = text;
  el.textContent = text;
}

function show(el, visible) {
  if (el.__shown === visible) return;
  el.__shown = visible;
  el.hidden = !visible;
  el.classList.toggle('is-off', !visible);
}

function resolveTheme(look) {
  if (look.theme === 'dark' || look.theme === 'light') return look.theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function createClockView(host, { preview = false } = {}) {
  host.innerHTML = HTML;
  const panel = host.querySelector('.panel');
  const el = {
    time: panel.querySelector('.r-time'),
    tMain: panel.querySelector('.t-main'),
    tSec: panel.querySelector('.t-sec'),
    zone: panel.querySelector('.zone'),
    lunarRow: panel.querySelector('.r-lunar'),
    lMain: panel.querySelector('.l-main'),
    lSub: panel.querySelector('.l-sub'),
    dateRow: panel.querySelector('.r-date'),
    dDate: panel.querySelector('.d-date'),
    dWeek: panel.querySelector('.d-week'),
    infoRow: panel.querySelector('.r-info'),
    cLunar: panel.querySelector('.c-lunar'),
    cTerm: panel.querySelector('.c-term'),
    cFest: panel.querySelector('.c-fest'),
    cCount: panel.querySelector('.c-count'),
    cGanzhi: panel.querySelector('.c-ganzhi'),
    singleRow: panel.querySelector('.r-single'),
    dot: panel.querySelector('.dot'),
  };

  if (!preview) {
    panel.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      host.dispatchEvent(new CustomEvent('clock-contextmenu', { bubbles: true }));
    });
    panel.addEventListener('dblclick', () => host.dispatchEvent(new CustomEvent('clock-open-settings', { bubbles: true })));
  }

  let lastMeasured = { width: 0, height: 0 };

  function applyStyle(config) {
    const { look } = config;
    const preset = presetOf(config);
    const scale = look.scale;
    panel.dataset.preset = config.content.preset;
    panel.dataset.theme = resolveTheme(look);
    panel.dataset.shadow = look.textShadow ? 'on' : 'off';
    panel.style.setProperty('--scale', String(scale));
    panel.style.setProperty('--accent', look.accent);
    panel.style.setProperty('--panel-a', String(look.panelOpacity));
    panel.style.setProperty('--weight', String(look.fontWeight));
    panel.style.setProperty('--radius', `${Math.round(look.radius * scale)}px`);
    panel.style.setProperty('--font', FONT_STACKS[look.fontFamily] || FONT_STACKS.default);
    const base = TIME_SIZE[preset.timeSize] || 52;
    panel.style.setProperty('--time-size', `${Math.round(base * scale)}px`);
  }

  function measure() {
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(host);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const width = Math.ceil(rect.width + padX) + 2;
    const height = Math.ceil(rect.height + padY) + 2;
    if (Math.abs(width - lastMeasured.width) < 2 && Math.abs(height - lastMeasured.height) < 2) return lastMeasured;
    lastMeasured = { width, height };
    return lastMeasured;
  }

  /**
   * @param {object} model
   * @param {number} model.nowMs
   * @param {object} model.config
   * @param {string} model.systemTimeZone
   * @param {object} model.calendar  createCalendar 的返回值
   * @param {object} model.holidays  HolidayDb
   * @param {object} model.clockState
   * @param {object|null} model.nextHoliday
   */
  function update(model) {
    const { nowMs, config, systemTimeZone, calendar, holidays, clockState, nextHoliday } = model;
    const tz = config.time.timeZone === 'auto' ? systemTimeZone : config.time.timeZone;
    const p = zonedParts(nowMs, tz);
    const preset = presetOf(config);
    const parts = partsOf(config);
    applyStyle(config);

    const info = calendar.info({ y: p.y, m: p.mo, d: p.d });
    const holiday = holidays?.info?.(p.y, p.mo, p.d) || null;

    // —— 时间行 ——
    const timeText = formatTime(p.h, p.mi, p.s, { hour12: config.time.hour12, showSeconds: false });
    setText(el.tMain, timeText);
    const showSec = parts.seconds && config.time.showSeconds && preset.rows.includes('time');
    setText(el.tSec, showSec ? String(p.s).padStart(2, '0') : '');
    show(el.tSec, showSec);
    setText(el.zone, parts.zone ? offsetLabel(p.offsetMinutes) : '');
    show(el.zone, Boolean(parts.zone));

    // —— 农历大字（农历详情版式） ——
    if (preset.rows.includes('lunar')) {
      setText(el.lMain, info.lunarText);
      setText(el.lSub, `${info.ganzhi}年 · 属${info.zodiac}`);
      show(el.lunarRow, Boolean(parts.lunar));
    } else {
      show(el.lunarRow, false);
    }

    // —— 日期行 ——
    const dateText = config.time.showYear ? `${p.y}年${p.mo}月${p.d}日` : `${p.mo}月${p.d}日`;
    setText(el.dDate, parts.date ? dateText : '');
    setText(el.dWeek, parts.weekday ? p.weekdayText : '');
    show(el.dDate, Boolean(parts.date));
    show(el.dWeek, Boolean(parts.weekday));
    if (preset.rows.includes('date')) {
      show(el.dateRow, Boolean(parts.date || parts.weekday));
    } else {
      show(el.dateRow, false);
    }

    // —— 信息行 ——
    const showLunarChip = Boolean(parts.lunar) && !preset.rows.includes('lunar');
    setText(el.cLunar, showLunarChip ? info.lunarText : '');
    show(el.cLunar, showLunarChip);

    let termText = '';
    let termKind = '';
    if (parts.term) {
      if (info.termToday) {
        termText = info.termToday;
        termKind = 'term-now';
      } else if (info.nextTerm) {
        termText = `距${info.nextTerm.name} ${info.nextTerm.days}天`;
        termKind = 'term-next';
      }
    }
    setText(el.cTerm, termText);
    el.cTerm.dataset.kind = termKind;
    show(el.cTerm, Boolean(termText));

    let festText = '';
    let festKind = '';
    if (parts.holiday) {
      if (holiday?.type === 'holiday') {
        festText = holiday.name;
        festKind = 'holiday';
      } else if (holiday?.type === 'inLieu') {
        festText = `${holiday.name}·调休`;
        festKind = 'inLieu';
      } else if (holiday?.type === 'workday') {
        festText = `${holiday.name}·补班`;
        festKind = 'workday';
      } else if (info.festivals.length) {
        festText = info.festivals[0];
        festKind = 'festival';
      } else if (info.otherFestivals.length) {
        festText = info.otherFestivals[0];
        festKind = 'festival';
      }
    }
    setText(el.cFest, festText);
    el.cFest.dataset.kind = festKind;
    show(el.cFest, Boolean(festText));

    const countText = parts.countdown && nextHoliday ? `距${nextHoliday.name} ${nextHoliday.days}天` : '';
    setText(el.cCount, countText);
    show(el.cCount, Boolean(countText));

    const ganzhiText = parts.ganzhi ? `${info.ganzhi} · ${info.zodiac}` : '';
    setText(el.cGanzhi, ganzhiText);
    show(el.cGanzhi, Boolean(ganzhiText));

    const infoVisible = Boolean(showLunarChip || termText || festText || countText || ganzhiText);
    show(el.infoRow, preset.rows.includes('info') && infoVisible);

    // —— 单行版式 ——
    if (preset.rows.includes('single')) {
      const chunks = [];
      if (parts.weekday) chunks.push(p.weekdayText);
      if (parts.date) chunks.push(`${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`);
      chunks.push(formatTime(p.h, p.mi, p.s, { hour12: config.time.hour12, showSeconds: parts.seconds && config.time.showSeconds }));
      if (parts.lunar) chunks.push(info.lunarText);
      if (parts.term) chunks.push(info.termToday || `距${info.nextTerm?.name ?? ''} ${info.nextTerm?.days ?? ''}天`);
      if (parts.holiday && (holiday?.name || info.festivals.length)) chunks.push(holiday?.name || info.festivals[0]);
      setText(el.singleRow, chunks.filter(Boolean).join('  ·  '));
      show(el.singleRow, true);
    } else {
      show(el.singleRow, false);
    }

    // —— 显示的时间行 ——
    show(el.time, preset.rows.includes('time'));

    // —— 授时状态点 ——
    const syncVisible = parts.sync;
    show(el.dot, Boolean(syncVisible));
    if (syncVisible) {
      let kind = 'system';
      let label = '本机系统时间';
      if (clockState) {
        if (config.clock.source === 'system') {
          kind = 'system';
          label = '使用本机系统时间';
        } else if (clockState.status === 'ok') {
          kind = clockState.effectiveSource === 'ntp' ? 'ok' : 'http';
          label = `已对齐 ${clockState.server || ''}（偏差 ${clockState.offsetMs > 0 ? '+' : ''}${clockState.offsetMs} ms）`;
        } else if (clockState.status === 'syncing') {
          kind = 'syncing';
          label = '正在同步网络时间…';
        } else {
          kind = 'error';
          label = `同步失败：${clockState.error || '未知错误'}`;
        }
      }
      el.dot.dataset.kind = kind;
      el.dot.title = label;
    }

    return { ymd: p.ymd, parts: p, info };
  }

  return { update, measure, panel, element: panel };
}

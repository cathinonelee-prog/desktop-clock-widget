/** 时区感知的时间解析与格式化工具（不依赖第三方库） */

const formatterCache = new Map();

function partsFormatter(timeZone) {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAYS_LONG = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y, m) {
  return m === 2 && isLeapYear(y) ? 29 : MONTH_DAYS[m - 1];
}

/** 该时区在某一时刻的日期/时间分量 */
export function zonedParts(utcMs, timeZone) {
  const list = partsFormatter(timeZone).formatToParts(new Date(utcMs));
  const map = {};
  for (const p of list) if (p.type !== 'literal') map[p.type] = p.value;
  const y = Number(map.year);
  const mo = Number(map.month);
  const d = Number(map.day);
  const h = Number(map.hour) % 24;
  const mi = Number(map.minute);
  const s = Number(map.second);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return {
    y,
    mo,
    d,
    h,
    mi,
    s,
    weekday,
    weekdayText: WEEKDAYS[weekday],
    weekdayLong: WEEKDAYS_LONG[weekday],
    ymd: `${y}-${pad2(mo)}-${pad2(d)}`,
    isoWeek: isoWeekNumber(y, mo, d),
    // 该时区相对 UTC 的偏移（分钟）
    offsetMinutes: Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(utcMs / 1000) * 1000) / 60000),
  };
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function isoWeekNumber(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

/** UTC+8 / UTC+5:30 / UTC-3 文本 */
export function offsetLabel(offsetMinutes) {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ':' + pad2(m) : ''}`;
}

/** 时区城市名（用于标记，如 Asia/Shanghai -> 上海） */
export function timeZoneHint(tz) {
  if (!tz || tz === 'auto') return '跟随系统';
  const city = tz.split('/').pop() || tz;
  return city.replace(/_/g, ' ');
}

export function formatTime(h, mi, s, { hour12 = false, showSeconds = true, padHour = true } = {}) {
  let hour = h;
  let suffix = '';
  if (hour12) {
    suffix = h < 12 ? ' AM' : ' PM';
    hour = h % 12 || 12;
  }
  const hh = hour12 ? String(hour) : padHour ? pad2(hour) : String(hour);
  const base = `${hh}:${pad2(mi)}`;
  return showSeconds ? `${base}:${pad2(s)}${suffix}` : `${base}${suffix}`;
}

/** 两个 Y-M-D 之间相差的天数（按日历日计算，避免时区干扰） */
export function dayDiff(a, b) {
  const da = Date.UTC(a.y, a.m - 1, a.d);
  const db = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((db - da) / 86400000);
}

export function fromYmdKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

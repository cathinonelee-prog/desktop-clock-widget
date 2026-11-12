/** 法定节假日 / 调休数据（随程序内置 2004-2027，来源：国务院办公厅放假安排） */

const BASE = 'app://clock/data/holidays';

const yearCache = new Map();

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function ymdKey(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

async function loadYear(year) {
  if (yearCache.has(year)) return yearCache.get(year);
  const promise = (async () => {
    try {
      const res = await fetch(`${BASE}/${year}.json`, { cache: 'no-cache' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  })();
  yearCache.set(year, promise);
  return promise;
}

function parseEntry(value) {
  const parts = String(value).split(',');
  return { name: parts[1] || parts[0], days: Number(parts[2]) || 1 };
}

export class HolidayDb {
  constructor() {
    this.years = new Set();
  }

  /** 预加载某年及后一年，返回是否可用 */
  async ensure(year) {
    if (this.years.has(year) && this.years.has(year + 1)) return true;
    const [a, b] = await Promise.all([loadYear(year), loadYear(year + 1)]);
    if (a) this.years.add(year);
    if (b) this.years.add(year + 1);
    return Boolean(a || b);
  }

  cached(year) {
    const v = yearCache.get(year);
    return v && typeof v.then === 'function' ? null : v;
  }

  /**
   * 同步查询（数据未加载时返回 null）
   * 返回 { type: 'holiday' | 'inLieu' | 'workday', name, days }
   */
  info(y, m, d) {
    const data = this.cached(y);
    if (!data) return null;
    const key = ymdKey(y, m, d);
    if (data.workdays && data.workdays[key]) {
      return { type: 'workday', ...parseEntry(data.workdays[key]) };
    }
    if (data.holidays && data.holidays[key]) {
      const entry = parseEntry(data.holidays[key]);
      const inLieu = Boolean(data.inLieuDays && data.inLieuDays[key]);
      return { type: inLieu ? 'inLieu' : 'holiday', ...entry };
    }
    return null;
  }

  /** 从 from 的次日开始找下一个法定假期首日 */
  async nextHoliday(from, maxDays = 420) {
    const cursor = new Date(Date.UTC(from.y, from.m - 1, from.d));
    let prevIsHoliday = this.info(from.y, from.m, from.d)?.type === 'holiday';
    for (let i = 1; i <= maxDays; i += 1) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const y = cursor.getUTCFullYear();
      const m = cursor.getUTCMonth() + 1;
      const d = cursor.getUTCDate();
      if (!this.cached(y)) await loadYear(y);
      const info = this.info(y, m, d);
      const isHoliday = info?.type === 'holiday';
      if (isHoliday && !prevIsHoliday) {
        return { name: info.name, dateKey: ymdKey(y, m, d), days: i };
      }
      prevIsHoliday = isHoliday;
    }
    return null;
  }
}

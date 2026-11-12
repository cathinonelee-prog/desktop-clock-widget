/** 农历、节气、传统节日（基于内置 lunar-javascript，日期按显示时区的本地日期计算） */

import { dayDiff } from './format.mjs';

const SOLAR_TERM_ORDER = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
  '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
];

/** 法定节日的中文名归一化（避免“元旦节”“国庆节”这类读着别扭的写法） */
const NAME_ALIAS = {
  元旦节: '元旦',
  国庆节: '国庆',
  中秋节: '中秋',
  端午节: '端午',
  劳动节: '劳动节',
  儿童节: '儿童节',
  妇女节: '妇女节',
};

function alias(name) {
  return NAME_ALIAS[name] || name;
}

export function createCalendar(Solar) {
  if (!Solar) throw new Error('Solar 未加载');

  return {
    /** 某一天（显示时区的年月日）的农历与节日信息 */
    info({ y, m, d }) {
      const solar = Solar.fromYmd(y, m, d);
      const lunar = solar.getLunar();

      const isLeap = lunar.getMonth() < 0;
      const monthCN = lunar.getMonthInChinese(); // 闰月时已自带“闰”字
      const dayCN = lunar.getDayInChinese();
      const lunarText = `${monthCN}月${dayCN}`;

      const ganzhi = lunar.getYearInGanZhi();
      const zodiac = lunar.getYearShengXiao();

      const termToday = lunar.getJieQi() || '';

      let nextTerm = null;
      try {
        const nx = lunar.getNextJieQi(true);
        const nxSolar = nx.getSolar();
        const days = dayDiff({ y, m, d }, { y: nxSolar.getYear(), m: nxSolar.getMonth(), d: nxSolar.getDay() });
        nextTerm = { name: nx.getName(), days: Math.max(1, days) };
      } catch {
        nextTerm = null;
      }

      const solarFestivals = (solar.getFestivals() || []).map(alias);
      const lunarFestivals = (lunar.getFestivals() || []).map(alias);
      const others = [...(solar.getOtherFestivals() || []), ...(lunar.getOtherFestivals() || [])]
        .filter((n) => n && !n.startsWith('国际') && n.length <= 6)
        .map(alias);

      return {
        lunarText,
        lunarMonthText: `${monthCN}月`,
        lunarDayText: dayCN,
        lunarYearText: `${lunar.getYearInChinese()}年`,
        ganzhi,
        zodiac,
        termToday,
        nextTerm,
        festivals: [...new Set([...solarFestivals, ...lunarFestivals])],
        otherFestivals: [...new Set(others)].filter((n) => !solarFestivals.includes(n) && !lunarFestivals.includes(n)),
      };
    },

    solarTermsOfYear(year) {
      return SOLAR_TERM_ORDER.map((name) => name);
    },
  };
}

export { SOLAR_TERM_ORDER };

/** 显示模式：版式（结构） */
export const PRESETS = {
  minimal: {
    label: '极简时间',
    desc: '只显示时间',
    timeSize: 'xl',
    rows: ['time'],
  },
  standard: {
    label: '时间 · 日期',
    desc: '时间 + 日期星期',
    timeSize: 'lg',
    rows: ['time', 'date'],
  },
  full: {
    label: '完整信息',
    desc: '再加农历、节气、节日',
    timeSize: 'lg',
    rows: ['time', 'date', 'info'],
  },
  lunar: {
    label: '农历详情',
    desc: '农历大字 + 干支 + 节气',
    timeSize: 'md',
    rows: ['time', 'lunar', 'info'],
  },
  single: {
    label: '单行紧凑',
    desc: '一行显示全部',
    timeSize: 'sm',
    rows: ['single'],
  },
};

export const PRESET_IDS = Object.keys(PRESETS);

/** 元素开关：控制每个版式里的具体内容 */
export const PART_META = [
  { key: 'date', label: '日期', hint: '11月11日' },
  { key: 'weekday', label: '星期', hint: '周三' },
  { key: 'seconds', label: '秒', hint: '19:11:36' },
  { key: 'lunar', label: '农历', hint: '十月初三' },
  { key: 'term', label: '节气', hint: '距小雪 11 天' },
  { key: 'holiday', label: '节日 / 假日', hint: '春节 · 调休' },
  { key: 'countdown', label: '假日倒计时', hint: '距元旦 51 天' },
  { key: 'ganzhi', label: '干支生肖', hint: '丙午 · 马' },
  { key: 'zone', label: '时区标记', hint: 'UTC+8' },
  { key: 'sync', label: '授时状态点', hint: '右上角小圆点' },
];

export function presetOf(config) {
  return PRESETS[config.content?.preset] || PRESETS.full;
}

export function partsOf(config) {
  const defaults = { date: true, weekday: true, seconds: true, lunar: true, term: true, holiday: true, countdown: false, zone: false, ganzhi: false, sync: true };
  return { ...defaults, ...(config.content?.parts || {}) };
}

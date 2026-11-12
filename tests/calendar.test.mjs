import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createCalendar } from '../src/renderer/lib/calendar.mjs';
import { zonedParts, formatTime, offsetLabel, isoWeekNumber, dayDiff } from '../src/renderer/lib/format.mjs';

const require = createRequire(import.meta.url);
const { Solar } = require('../src/vendor/lunar.js');
const calendar = createCalendar(Solar);

test('春节：2026-02-17 为农历正月初一', () => {
  const info = calendar.info({ y: 2026, m: 2, d: 17 });
  assert.equal(info.lunarText, '正月初一');
  assert.deepEqual(info.festivals, ['春节']);
  assert.equal(info.ganzhi, '丙午');
  assert.equal(info.zodiac, '马');
});

test('闰月：2025-07-25 为农历闰六月初一', () => {
  const info = calendar.info({ y: 2025, m: 7, d: 25 });
  assert.equal(info.lunarText, '闰六月初一');
});

test('节气：2026-11-22 小雪，前一天显示距小雪 1 天', () => {
  const today = calendar.info({ y: 2026, m: 11, d: 22 });
  assert.equal(today.termToday, '小雪');
  const before = calendar.info({ y: 2026, m: 11, d: 21 });
  assert.equal(before.termToday, '');
  assert.equal(before.nextTerm.name, '小雪');
  assert.equal(before.nextTerm.days, 1);
});

test('传统节日：中秋 / 端午', () => {
  assert.deepEqual(calendar.info({ y: 2026, m: 9, d: 25 }).festivals, ['中秋']);
  assert.deepEqual(calendar.info({ y: 2026, m: 6, d: 19 }).festivals, ['端午']);
});

test('时区换算：UTC 03:00 -> Asia/Shanghai 11:00', () => {
  const utc = Date.UTC(2026, 10, 12, 3, 0, 0);
  const parts = zonedParts(utc, 'Asia/Shanghai');
  assert.equal(parts.y, 2026);
  assert.equal(parts.mo, 11);
  assert.equal(parts.d, 12);
  assert.equal(parts.h, 11);
  assert.equal(parts.mi, 0);
  assert.equal(parts.offsetMinutes, 480);
  assert.equal(offsetLabel(parts.offsetMinutes), 'UTC+8');
  assert.equal(formatTime(parts.h, parts.mi, 5, { showSeconds: false }), '11:00');
});

test('跨日：UTC 16:30 -> 洛杉矶仍是前一天', () => {
  const utc = Date.UTC(2026, 10, 12, 3, 30, 0);
  const parts = zonedParts(utc, 'America/Los_Angeles');
  assert.equal(parts.d, 11);
  assert.equal(parts.h, 19);
  assert.equal(parts.offsetMinutes, -480);
  assert.equal(offsetLabel(parts.offsetMinutes), 'UTC-8');
});

test('12 小时制与秒', () => {
  assert.equal(formatTime(19, 5, 9, { hour12: true }), '7:05:09 PM');
  assert.equal(formatTime(19, 5, 9, { hour12: true, showSeconds: false }), '7:05 PM');
  assert.equal(formatTime(0, 0, 0), '00:00:00');
});

test('ISO 周数与日期差', () => {
  assert.equal(isoWeekNumber(2026, 11, 11), 46);
  assert.equal(isoWeekNumber(2026, 1, 1), 1);
  assert.equal(dayDiff({ y: 2026, m: 11, d: 11 }, { y: 2026, m: 11, d: 22 }), 11);
});

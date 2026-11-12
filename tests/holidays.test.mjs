import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'src', 'data', 'holidays');

const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));

test('节假日数据覆盖 2004-2027', () => {
  const years = files.map((f) => Number(f.replace('.json', ''))).sort();
  assert.equal(years[0], 2004);
  assert.equal(years[years.length - 1], 2027);
});

test('每一年份数据格式正确、日期与星期合法', () => {
  for (const file of files) {
    const data = JSON.parse(readFileSync(path.join(dataDir, file), 'utf8'));
    assert.ok(data.holidays && typeof data.holidays === 'object', `${file} 缺少 holidays`);
    for (const key of Object.keys(data.holidays)) {
      const [y, m, d] = key.split('-').map(Number);
      assert.ok(y === Number(file.replace('.json', '')), `${file} 日期年份不符: ${key}`);
      assert.ok(m >= 1 && m <= 12, `${file} 月份非法: ${key}`);
      assert.ok(d >= 1 && d <= 31, `${file} 日期非法: ${key}`);
      const parts = data.holidays[key].split(',');
      assert.ok(parts.length >= 2, `${file} 条目格式异常: ${key}`);
      assert.match(parts[1], /[\u4e00-\u9fa5]/, `${file} 缺少中文名: ${key}`);
    }
    for (const key of Object.keys(data.workdays || {})) {
      assert.match(key, /^\d{4}-\d{2}-\d{2}$/, `${file} 调休日期格式异常: ${key}`);
    }
  }
});

test('2026 年国庆假期为 10-01 至 10-07', () => {
  const data = JSON.parse(readFileSync(path.join(dataDir, '2026.json'), 'utf8'));
  const days = Object.keys(data.holidays).filter((k) => data.holidays[k].includes('国庆节')).sort();
  assert.deepEqual(days, [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
  ]);
});

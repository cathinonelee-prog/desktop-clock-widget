import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pickBest } = require('../src/main/clock.js');
const { sanitize, DEFAULT_CONFIG } = require('../src/main/config.js');

test('pickBest 选择往返延迟最小的样本', () => {
  const samples = [
    { offset: 120, rtt: 240, host: 'a' },
    { offset: 105, rtt: 42, host: 'b' },
    { offset: 130, rtt: 90, host: 'c' },
  ];
  assert.equal(pickBest(samples).host, 'b');
});

test('pickBest 丢弃明显异常（超过一天的偏移）', () => {
  const samples = [
    { offset: 99999999999, rtt: 5, host: 'bad' },
    { offset: 50, rtt: 80, host: 'good' },
  ];
  assert.equal(pickBest(samples).host, 'good');
  assert.equal(pickBest([]), null);
});

test('配置清洗：非法值回落到默认值', () => {
  const cfg = sanitize({
    clock: { intervalMin: -5, timeoutMs: 999999, source: 'weird', servers: ['bad host', 'ntp.aliyun.com'] },
    time: { timeZone: 'Not/AZone' },
    look: { panelOpacity: 9, scale: 99, accent: 'red' },
    content: { preset: 'nope', parts: { date: 'yes' } },
    window: { layer: 'float' },
    instances: [],
  });
  assert.equal(cfg.clock.intervalMin, 1);
  assert.equal(cfg.clock.timeoutMs, 20000);
  assert.equal(cfg.clock.source, 'ntp');
  assert.deepEqual(cfg.clock.servers, ['ntp.aliyun.com']);
  assert.equal(cfg.time.timeZone, 'auto');
  assert.equal(cfg.look.panelOpacity, 1);
  assert.equal(cfg.look.scale, 3);
  assert.equal(cfg.look.accent, DEFAULT_CONFIG.look.accent);
  assert.equal(cfg.content.preset, 'full');
  assert.equal(cfg.content.parts.date, true);
  assert.equal(cfg.window.layer, 'alwaysOnTop');
  assert.equal(cfg.instances.length, 1);
  assert.equal(cfg.instances[0].id, 'main');
});

test('配置清洗：保留合法的自定义值并修正实例', () => {
  const cfg = sanitize({
    time: { timeZone: 'Europe/London' },
    instances: [
      { id: 'a', name: '客厅', displayId: '12345', preset: 'minimal' },
      { id: 'a', name: '重复 id' },
      { id: 'b', name: '副屏', displayId: 'auto', preset: 'bad' },
    ],
  });
  assert.equal(cfg.time.timeZone, 'Europe/London');
  assert.equal(cfg.instances.length, 3);
  assert.equal(cfg.instances[0].displayId, '12345');
  assert.equal(cfg.instances[0].preset, 'minimal');
  assert.equal(cfg.instances[1].preset, null);
  assert.notEqual(cfg.instances[0].id, cfg.instances[1].id);
});

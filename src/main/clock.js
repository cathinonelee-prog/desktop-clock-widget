'use strict';

const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');

const NTP_EPOCH_OFFSET = 2208988800; // 1900-01-01 -> 1970-01-01 (秒)
const MAX_REASONABLE_OFFSET = 24 * 3600 * 1000; // 超过一天视为异常，丢弃

/**
 * 一次 SNTP 查询。
 * 返回 { offset, rtt, serverMs }，其中 offset = 服务器时间 - 本机时间。
 */
function queryNtp(host, timeoutMs = 2500, port = 123) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const packet = Buffer.alloc(48);
    packet[0] = 0x1b; // LI=0, VN=3, Mode=3 (client)

    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* 忽略重复关闭 */
      }
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => finish(new Error('超时')), timeoutMs);

    socket.once('error', (err) => finish(err));
    socket.once('message', (msg) => {
      const t4 = Date.now();
      if (!msg || msg.length < 48) {
        finish(new Error('响应过短'));
        return;
      }
      const seconds = msg.readUInt32BE(40);
      const fraction = msg.readUInt32BE(44);
      if (!seconds) {
        finish(new Error('响应无效'));
        return;
      }
      const serverMs = (seconds - NTP_EPOCH_OFFSET) * 1000 + Math.round((fraction / 2 ** 32) * 1000);
      const offset = serverMs - t4;
      const rtt = t4 - t1;
      finish(null, { offset, rtt, serverMs, host });
    });

    const t1 = Date.now();
    socket.send(packet, 0, packet.length, port, host, (err) => {
      if (err) finish(err);
    });
  });
}

/** 用 HTTPS 响应头 Date 兜底（精度约 ±0.5s） */
async function queryHttp(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const sentAt = Date.now();
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'cache-control': 'no-cache' },
      signal: controller.signal,
    });
    const receivedAt = Date.now();
    const header = res.headers.get('date');
    await res.body?.cancel().catch(() => {});
    if (!header) throw new Error('响应缺少 Date 头');
    const serverMs = Date.parse(header);
    if (!Number.isFinite(serverMs)) throw new Error('Date 头无法解析');
    const rtt = receivedAt - sentAt;
    // Date 头精确到秒，取中值近似
    const corrected = serverMs + 500 + rtt / 2;
    return { offset: corrected - receivedAt, rtt, serverMs: corrected, host: new URL(url).host };
  } finally {
    clearTimeout(timer);
  }
}

function pickBest(samples) {
  const valid = samples.filter(
    (s) => Number.isFinite(s.offset) && Number.isFinite(s.rtt) && Math.abs(s.offset) < MAX_REASONABLE_OFFSET,
  );
  if (!valid.length) return null;
  // 取往返延迟最小的一次：延迟越小，时间误差越小
  valid.sort((a, b) => a.rtt - b.rtt);
  return valid[0];
}

class ClockService extends EventEmitter {
  constructor(configStore) {
    super();
    this.configStore = configStore;
    this.offsetMs = 0;
    this.rttMs = null;
    this.server = null;
    this.source = 'system';
    this.status = 'idle';
    this.error = null;
    this.syncedAt = null;
    this.nextSyncAt = null;
    this.samples = [];
    this.syncing = null;
    this.timer = null;
    this.lastWall = Date.now();
    this.watchdog = null;
    this.started = false;
  }

  get config() {
    return this.configStore.get().clock;
  }

  /** 当前“网络对齐后”的时间戳（毫秒） */
  now() {
    return Date.now() + this.offsetMs;
  }

  state() {
    const { source } = this.config;
    return {
      source,
      effectiveSource: this.source,
      status: this.status,
      error: this.error,
      offsetMs: Math.round(this.offsetMs),
      rttMs: this.rttMs === null ? null : Math.round(this.rttMs),
      server: this.server,
      syncedAt: this.syncedAt,
      nextSyncAt: this.nextSyncAt,
      now: source === 'system' ? Date.now() : this.now(),
      samples: this.samples.map((s) => ({ host: s.host, offset: Math.round(s.offset), rtt: Math.round(s.rtt), via: s.via })),
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.#scheduleNext(0);
    this.#startWatchdog();
  }

  stop() {
    this.started = false;
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
    this.timer = null;
    this.watchdog = null;
  }

  /** 配置变化后重新排期（同步间隔、时间源等） */
  reload() {
    if (!this.started) return;
    if (this.config.source === 'system') {
      this.offsetMs = 0;
      this.source = 'system';
      this.status = 'ok';
      this.error = null;
      this.syncedAt = Date.now();
      this.#emit();
    }
    this.#scheduleNext(this.config.source === 'system' ? null : 1000);
  }

  #scheduleNext(delayMs) {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.started) return;
    if (delayMs === null) {
      this.nextSyncAt = null;
      this.#emit();
      return;
    }
    const interval = Math.max(1, this.config.intervalMin) * 60 * 1000;
    this.nextSyncAt = Date.now() + delayMs;
    this.#emit();
    this.timer = setTimeout(() => {
      this.sync().finally(() => this.#scheduleNext(interval));
    }, delayMs);
    if (this.timer.unref) this.timer.unref();
  }

  /**
   * 立即同步一次。并发调用共享同一个 Promise。
   * force=false 时若 30 秒内刚同步过则直接返回。
   */
  async sync({ force = true } = {}) {
    if (this.config.source === 'system') {
      this.source = 'system';
      this.status = 'ok';
      this.offsetMs = 0;
      this.error = null;
      this.syncedAt = Date.now();
      this.#emit();
      return this.state();
    }
    if (!force && this.syncedAt && Date.now() - this.syncedAt < 30_000 && this.status === 'ok') {
      return this.state();
    }
    if (this.syncing) return this.syncing;

    this.status = 'syncing';
    this.error = null;
    this.#emit();

    this.syncing = (async () => {
      const cfg = this.config;
      const timeout = cfg.timeoutMs;
      const samples = [];
      const errors = [];

      // 1) NTP：多个服务器依次尝试（UDP 123 可能被网络策略拦截）
      for (const host of cfg.servers) {
        try {
          const r = await queryNtp(host, timeout);
          samples.push({ ...r, via: 'ntp' });
          if (samples.length >= 3) break;
        } catch (err) {
          errors.push(`${host}: ${err.message}`);
        }
        if (samples.length >= 1 && samples[0].rtt < 60) break; // 延迟已经很好，不必再问
      }

      // 2) HTTP 兜底
      if (!samples.length && cfg.httpFallback) {
        for (const url of cfg.httpUrls) {
          try {
            const r = await queryHttp(url, timeout + 1500);
            samples.push({ ...r, via: 'http' });
            break;
          } catch (err) {
            errors.push(`${new URL(url).host}: ${err.message}`);
          }
        }
      }

      const best = pickBest(samples);
      this.samples = samples;
      if (!best) {
        this.status = 'error';
        this.error = errors.slice(0, 3).join('; ') || '无法连接授时服务器';
        this.syncedAt = Date.now();
        this.source = 'system';
        this.offsetMs = 0;
        this.#emit();
        return this.state();
      }

      this.offsetMs = best.offset;
      this.rttMs = best.rtt;
      this.server = best.host;
      this.source = best.via;
      this.status = 'ok';
      this.error = null;
      this.syncedAt = Date.now();
      this.lastWall = Date.now();
      this.#emit();
      this.syncing = null;
      return this.state();
    })();

    try {
      return await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  /** 本机时钟被手动改动时（跳变 > 3 秒），立即重新对齐 */
  #startWatchdog() {
    clearInterval(this.watchdog);
    this.lastWall = Date.now();
    this.watchdog = setInterval(() => {
      const now = Date.now();
      const delta = now - this.lastWall;
      if (Math.abs(delta - 1000) > 3000) {
        this.lastWall = now;
        if (this.config.source === 'ntp') this.sync({ force: true });
      } else {
        this.lastWall = now;
      }
    }, 1000);
    if (this.watchdog.unref) this.watchdog.unref();
  }

  #emit() {
    this.emit('state', this.state());
  }
}

module.exports = { ClockService, queryNtp, queryHttp, pickBest };

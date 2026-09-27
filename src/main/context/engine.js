const fs = require('node:fs');
const { clamp } = require('../config');
const { dHashFromBitmap, hammingDistance } = require('./dhash');
const { analyze } = require('./analyzer');
const { localDateKey } = require('./store');

/**
 * 上下文引擎：定时截屏 → 感知哈希去重 → 云端模型分析（无 Key 时基础感知降级）
 * → 事件存储（data/events.jsonl）→ 广播给桌宠与设置窗口。
 */
class ContextEngine {
  constructor({ config, store, files, capture, activeWindow, onEvent, logger = console }) {
    this.config = config;
    this.store = store;
    this.files = files;
    this.capture = capture;
    this.activeWindow = activeWindow;
    this.onEvent = onEvent;
    this.logger = logger;
    this.timer = null;
    this.lastHash = null;
    this.lastEvent = null;
    this.busySince = 0;
    this.usage = this._loadUsage();
  }

  _loadUsage() {
    try {
      return JSON.parse(fs.readFileSync(this.files.usage, 'utf8'));
    } catch {
      return { calls: 0, failures: 0, lastAt: 0, lastSource: '' };
    }
  }

  _saveUsage() {
    try {
      fs.writeFileSync(this.files.usage, JSON.stringify(this.usage, null, 2));
    } catch {
      // 忽略写失败
    }
  }

  start() {
    this._schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  reschedule() {
    this.stop();
    if (this.config.get().context.enabled) this._schedule();
  }

  _schedule() {
    const sec = clamp(this.config.get().context.intervalSec, 15, 3600);
    this.timer = setTimeout(async () => {
      await this.tick();
      if (this.config.get().context.enabled) this._schedule();
    }, sec * 1000);
  }

  async tick() {
    try {
      await this.captureOnce(false);
    } catch (err) {
      this.logger.warn?.('[context] capture failed:', err?.message || err);
    }
  }

  busyMinutes() {
    return this.busySince ? Math.round((Date.now() - this.busySince) / 60000) : 0;
  }

  async captureOnce(force = false) {
    const cfg = this.config.get();
    if (!force && !cfg.context.enabled) return { changed: false, skipped: 'disabled' };

    const shot = await this.capture();
    if (!shot) return { changed: false, skipped: 'no-screen' };

    const jpeg = shot.image.toJPEG(72);
    const { width, height } = shot.image.getSize();
    const bitmap = typeof shot.image.toBitmap === 'function' ? shot.image.toBitmap() : shot.image.getBitmap();
    const hash = dHashFromBitmap(bitmap, width, height);
    if (!force && this.lastHash !== null && hammingDistance(this.lastHash, hash) <= 6) {
      return { changed: false, event: this.lastEvent };
    }

    const aw = await this.activeWindow().catch(() => ({ title: '', process: '' }));
    const result = await analyze({ jpeg, title: aw.title, process: aw.process, cfg });
    const cloudReady = !!(cfg.model.apiKey && cfg.model.model && cfg.model.baseUrl);
    if (cloudReady) {
      this.usage.calls += 1;
      if (result.source !== 'cloud') this.usage.failures += 1;
      this.usage.lastAt = Date.now();
      this.usage.lastSource = result.source;
      this._saveUsage();
    }

    const now = new Date();
    const evt = {
      ts: now.getTime(),
      date: localDateKey(now),
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      activity: result.activity,
      category: result.category,
      app: result.app,
      title: aw.title || '',
      isWorking: !!result.isWorking,
      note: result.note || '',
      suggest: result.suggest || '',
      source: result.source,
      cloudError: result.cloudError || ''
    };

    if (cfg.context.keepScreenshots) {
      try {
        fs.writeFileSync(this.files.latestShot, jpeg);
      } catch {
        // 忽略截图写失败
      }
    }

    this.store.append(evt);
    this.lastHash = hash;
    this.lastEvent = evt;
    if (evt.isWorking) {
      if (!this.busySince) this.busySince = evt.ts;
    } else {
      this.busySince = 0;
    }
    this.onEvent(evt);
    return { changed: true, event: evt };
  }
}

module.exports = { ContextEngine };

const fs = require('node:fs');
const { clamp } = require('../config');
const { dHashFromBitmap, findSimilarHash } = require('./dhash');
const { analyze } = require('./analyzer');
const { localDateKey } = require('./store');
const { ensureFreshNote } = require('./notes');

// 画面相似判定：与「最近多张」指纹比对（借鉴 MineContext 的窗口去重思路，阈值取其 2 与常见 6 之间）
const SIMILARITY_THRESHOLD = 4;
const HASH_WINDOW = 6;

/**
 * 上下文引擎：定时截屏 → 感知哈希窗口去重 → 云端模型分析（无 Key 时基础感知降级）
 * → 事件存储（data/events.jsonl）→ 广播给桌宠与设置窗口。
 * 画面未变化的轮次会累加为当前事件的「驻留时长」（durationMs），供日历与日报统计。
 */
class ContextEngine {
  constructor({ config, store, files, capture, activeWindow, uiText = null, onEvent, logger = console }) {
    this.config = config;
    this.store = store;
    this.files = files;
    this.capture = capture;
    this.activeWindow = activeWindow;
    this.uiText = uiText;
    this.onEvent = onEvent;
    this.logger = logger;
    this.timer = null;
    this.recentHashes = [];
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

    const dupIndex = findSimilarHash(hash, this.recentHashes, SIMILARITY_THRESHOLD);
    if (dupIndex === -1) {
      this.recentHashes.push(hash);
      if (this.recentHashes.length > HASH_WINDOW) this.recentHashes.shift();
    }

    if (!force && dupIndex !== -1) {
      // 画面未变化：把这一轮的感知间隔计入当前活动的驻留时长
      if (this.lastEvent) {
        const addMs = clamp(cfg.context.intervalSec, 15, 3600) * 1000;
        this.lastEvent.durationMs = (this.lastEvent.durationMs || 0) + addMs;
        this.store.updateLast({ durationMs: this.lastEvent.durationMs });
      }
      return { changed: false, extended: true, event: this.lastEvent };
    }

    const aw = await this.activeWindow().catch(() => ({ title: '', process: '' }));
    // 无障碍树文本摘录（可关）：本机只读、近零成本，给云端分析补上精确的文件名/报错原文
    let texts = [];
    if (cfg.context.uiText !== false && typeof this.uiText === 'function') {
      try {
        texts = (await this.uiText(aw)) || [];
      } catch {
        texts = [];
      }
    }
    // 最近几句观察：既提供给云端模型"别重复"，也用于本地兜底换一句新鲜的
    const recentNotes = this.store
      .readRecent(6)
      .map((e) => e.note)
      .filter(Boolean);
    const result = await analyze({ jpeg, title: aw.title, process: aw.process, texts, recentNotes, cfg });
    result.note = ensureFreshNote(result.note, recentNotes, { category: result.category });
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
      signal: result.signal || 'none',
      detail: result.detail || '',
      entities: result.entities || { project: '', files: [], keywords: [] },
      topics: Array.isArray(result.topics) ? result.topics : [],
      note: result.note || '',
      suggest: result.suggest || '',
      source: result.source,
      cloudError: result.cloudError || '',
      durationMs: 0
    };

    if (cfg.context.keepScreenshots) {
      try {
        fs.writeFileSync(this.files.latestShot, jpeg);
      } catch {
        // 忽略截图写失败
      }
    }

    this.store.append(evt);
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

module.exports = { ContextEngine, SIMILARITY_THRESHOLD, HASH_WINDOW };

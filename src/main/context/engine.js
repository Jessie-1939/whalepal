const fs = require('node:fs');
const { clamp } = require('../config');
const { dHashFromBitmap, findSimilarHash } = require('./dhash');
const { analyze } = require('./analyzer');
const { localDateKey } = require('./store');
const { ensureFreshNote } = require('./notes');
const { createUsageCollector, mergeUsage } = require('./usage');
const { usageCollector: chatUsage } = require('./chat');

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
    // 0.1.0 的 usage.json 只有累计次数、没有 byDay：把旧值当基数保留，新账从今天起按天记。
    this.legacyCalls = this.usage.byDay ? 0 : Number(this.usage.calls || 0);
    this.legacyFailures = this.usage.byDay ? 0 : Number(this.usage.failures || 0);
    // 进程内用量收集器：analyzer / chat 系（问答、摘要、搭话、台词）都往这里记，
    // 每轮 tick 结束时统一 drain 落盘，避免多处写同一个文件。
    this.usageCollector = createUsageCollector();
  }

  _loadUsage() {
    try {
      return JSON.parse(fs.readFileSync(this.files.usage, 'utf8'));
    } catch {
      return { calls: 0, failures: 0, lastAt: 0, lastSource: '', byDay: {}, bySource: {} };
    }
  }

  _saveUsage() {
    try {
      fs.writeFileSync(this.files.usage, JSON.stringify(this.usage, null, 2));
    } catch {
      // 忽略写失败
    }
  }

  /** 把收集器里的调用记录并入 usage.json（token 计数按日期与来源分组）。 */
  flushUsage() {
    // 两个来源：本引擎的视觉分析收集器 + chat.js 的文本调用收集器（问答/摘要/搭话/台词/测试连接）
    const records = [...this.usageCollector.drain(), ...chatUsage.drain()];
    if (!records.length) return this.usage;
    const stamp = localDateKey();
    for (const r of records) if (!r.dateKey) r.dateKey = stamp;
    this.usage = mergeUsage(this.usage, records, { dateKey: stamp });
    // 顶层计数器与 byDay 汇总保持一致（0.1.0 的旧值作为 legacy 基数保留）
    const totals = this.usage.totals || {};
    this.usage.calls = Number(this.legacyCalls || 0) + Number(totals.calls || 0);
    this.usage.failures = Number(this.legacyFailures || 0) + Number(totals.failures || 0);
    this.usage.lastAt = Date.now();
    this.usage.lastSource = records[records.length - 1].source;
    this._saveUsage();
    return this.usage;
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
    // 上一轮之间产生的文本调用（问答/搭话/台词）先落盘，避免要等到下一次画面变化才记账
    this.flushUsage();
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
    const result = await analyze({
      jpeg,
      title: aw.title,
      process: aw.process,
      texts,
      recentNotes,
      cfg,
      usage: this.usageCollector
    });
    // 观察台词的新鲜度兜底只在离线（基础感知）时用：云端给的观察原样保留，由模型自己换说法
    if (result.source !== 'cloud') {
      result.note = ensureFreshNote(result.note, recentNotes, { category: result.category });
    }
    // 计数与 token 统一在 flushUsage 里落盘（analyze 的成败已由 analyzer 记入收集器）
    this.flushUsage();

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
      speak: result.speak === true,
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

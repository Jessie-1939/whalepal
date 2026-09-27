/**
 * 主动关怀调度（三条线）：
 *  - 久坐提醒：连续工作 ≥25min，同类提醒间隔 ≥60min
 *  - 深夜劝休息：静默时段（默认 23:00–6:00）仍在忙，每晚至多一次
 *  - 回来打招呼：离开 ≥3min 后重新开始工作
 * 通用规则：任意两次关怀间隔 ≥15min；只发 tag，台词由渲染层台词库选取。
 */

class CareManager {
  constructor({ config, emit, logger = console }) {
    this.config = config;
    this.emit = emit;
    this.logger = logger;
    this.timer = null;
    this.state = {
      lastLineAt: 0,
      lastSittingAt: 0,
      nightFiredDate: '',
      lastWorkAt: 0,
      lastIdleAt: 0,
      busySince: 0
    };
  }

  start() {
    this.timer = setInterval(() => this.tick(), 30 * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onEvent(evt) {
    const now = evt.ts || Date.now();
    if (evt.isWorking) {
      const idleGap = this.state.lastIdleAt ? now - this.state.lastIdleAt : 0;
      if (idleGap >= 3 * 60 * 1000 && this._can(now)) {
        this._say('welcome', now);
      }
      this.state.lastWorkAt = now;
      if (!this.state.busySince) this.state.busySince = now;
    } else {
      this.state.lastIdleAt = now;
      this.state.busySince = 0;
    }
  }

  tick() {
    try {
      const cfg = this.config.get();
      if (!cfg.companion.care) return;
      const now = Date.now();

      // 久坐提醒
      if (
        this.state.busySince &&
        now - this.state.busySince >= 25 * 60 * 1000 &&
        now - this.state.lastSittingAt >= 60 * 60 * 1000 &&
        this._can(now)
      ) {
        this.state.lastSittingAt = now;
        this._say('sitting', now);
        return;
      }

      // 深夜劝休息
      const hour = new Date().getHours();
      const { start, end } = cfg.companion.quietHours || { start: 23, end: 6 };
      const inQuiet = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
      const dateKey = new Date().toISOString().slice(0, 10);
      if (
        inQuiet &&
        this.state.lastWorkAt &&
        now - this.state.lastWorkAt < 5 * 60 * 1000 &&
        this.state.nightFiredDate !== dateKey &&
        this._can(now)
      ) {
        this.state.nightFiredDate = dateKey;
        this._say('night', now);
      }
    } catch (err) {
      this.logger.warn?.('[care] tick failed:', err?.message || err);
    }
  }

  _can(now, minGapMs = 15 * 60 * 1000) {
    return now - this.state.lastLineAt >= minGapMs;
  }

  _say(tag, now) {
    this.state.lastLineAt = now;
    this.emit({ tag });
  }
}

module.exports = { CareManager };

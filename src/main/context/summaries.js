const fs = require('node:fs');
const path = require('node:path');

/**
 * 每日摘要缓存（data/summaries.jsonl，一天一条，后写覆盖先写）。
 * 对应上下文分层里的 L1：问答与主动搭话优先读摘要，而不是每次都翻全量事件明细。
 */
class SummaryStore {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '');
    this._load();
  }

  _load() {
    try {
      const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          if (e && e.date) this.map.set(e.date, e); // 后写覆盖
        } catch {
          // 跳过损坏行
        }
      }
    } catch {
      // 首次运行
    }
  }

  get(dateKey) {
    return this.map.get(dateKey) || null;
  }

  put(dateKey, entry) {
    const e = {
      date: dateKey,
      text: String(entry?.text || '').slice(0, 2000),
      source: entry?.source || 'records',
      generatedAt: Date.now()
    };
    if (!e.text) return null;
    this.map.set(dateKey, e);
    fs.appendFileSync(this.file, JSON.stringify(e) + '\n');
    return e;
  }

  /** 最近 n 天已缓存的摘要（按日期倒序）。 */
  recent(n = 7, beforeDateKey = '') {
    return [...this.map.values()]
      .filter((e) => !beforeDateKey || e.date < beforeDateKey)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, n);
  }

  clear() {
    fs.writeFileSync(this.file, '');
    this.map.clear();
  }
}

module.exports = { SummaryStore };

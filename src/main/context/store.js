const fs = require('node:fs');
const path = require('node:path');

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 上下文事件存储：JSONL 追加写，超过上限自动裁剪；全部位于 data/events.jsonl。 */
class EventStore {
  constructor(file, maxEvents = 5000) {
    this.file = file;
    this.maxEvents = maxEvents;
    this.count = 0;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '');
    this.count = this._lines().length;
  }

  _lines() {
    try {
      return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  _parseLines(lines) {
    const out = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // 跳过损坏行
      }
    }
    return out;
  }

  append(evt) {
    fs.appendFileSync(this.file, JSON.stringify(evt) + '\n');
    this.count++;
    if (this.count > Math.floor(this.maxEvents * 1.2)) this._prune();
  }

  _prune() {
    const lines = this._lines().slice(-this.maxEvents);
    fs.writeFileSync(this.file, lines.join('\n') + '\n');
    this.count = lines.length;
  }

  readRecent(n = 20) {
    return this._parseLines(this._lines().slice(-n));
  }

  /** 按日期区间读取（YYYY-MM-DD 闭区间，字符串比较即可）。 */
  readRange(fromKey, toKey) {
    const lines = this._lines().filter((line) => {
      const m = /"date":"(\d{4}-\d{2}-\d{2})"/.exec(line);
      return m && m[1] >= fromKey && m[1] <= toKey;
    });
    return this._parseLines(lines);
  }

  dayEvents(dateKey) {
    return this.readRange(dateKey, dateKey);
  }

  today() {
    return this.dayEvents(localDateKey());
  }

  /** 更新最后一条事件（用于驻留时长累积），整文件重写一行。 */
  updateLast(patch) {
    const lines = this._lines();
    if (!lines.length) return false;
    try {
      const last = JSON.parse(lines[lines.length - 1]);
      lines[lines.length - 1] = JSON.stringify({ ...last, ...patch });
      fs.writeFileSync(this.file, lines.join('\n') + '\n');
      return true;
    } catch {
      return false;
    }
  }

  stats() {
    const today = this.today();
    const byApp = {};
    const workingMs = today.reduce((sum, e) => sum + (Number(e.durationMs) > 0 ? Number(e.durationMs) : 0), 0);
    for (const e of today) {
      const app = e.app || '未知';
      byApp[app] = (byApp[app] || 0) + 1;
    }
    return {
      total: this.count,
      todayCount: today.length,
      workingCount: today.filter((e) => e.isWorking).length,
      workingMinutes: Math.round(workingMs / 60000),
      byApp
    };
  }

  clear() {
    fs.writeFileSync(this.file, '');
    this.count = 0;
  }
}

module.exports = { EventStore, localDateKey };

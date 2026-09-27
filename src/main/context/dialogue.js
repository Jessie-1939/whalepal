const fs = require('node:fs');
const path = require('node:path');

/**
 * 对话 / 互动记忆（data/dialogue.jsonl）：
 * 记录主人与鲸鱼娘之间的每一句可见发言与关键互动，用于：
 *  1. 让云端模型回答、摘要、主动搭话时"记得自己刚刚说过什么、主人有没有回应"；
 *  2. 判定主动消息是否未获回应（TIMEOUT_SIGNAL）与冷却；
 *  3. 发送前去重，避免复读。
 */
class DialogueStore {
  constructor(file, maxEntries = 400) {
    this.file = file;
    this.max = maxEntries;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '');
    this.entries = this._load();
  }

  _load() {
    try {
      return fs
        .readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .slice(-this.max);
    } catch {
      return [];
    }
  }

  append(entry) {
    if (!entry || !entry.text) return null;
    const e = {
      ts: Number(entry.ts) || Date.now(),
      role: entry.role === 'user' ? 'user' : 'pet',
      kind: entry.kind || 'bubble',
      text: String(entry.text).slice(0, 300)
    };
    this.entries.push(e);
    fs.appendFileSync(this.file, JSON.stringify(e) + '\n');
    if (this.entries.length > Math.floor(this.max * 1.2)) this._prune();
    return e;
  }

  _prune() {
    this.entries = this.entries.slice(-this.max);
    fs.writeFileSync(this.file, this.entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }

  recent(n = 12) {
    return this.entries.slice(-n);
  }

  lastOfRole(role) {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].role === role) return this.entries[i];
    }
    return null;
  }

  lastOfKind(kinds) {
    const list = Array.isArray(kinds) ? kinds : [kinds];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (list.includes(this.entries[i].kind)) return this.entries[i];
    }
    return null;
  }

  clear() {
    fs.writeFileSync(this.file, '');
    this.entries = [];
  }
}

module.exports = { DialogueStore };

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import builder from '../src/main/context/builder.js';
import { SummaryStore } from '../src/main/context/summaries.js';

const NOW = new Date('2026-09-27T15:00:00');
const TODAY = '2026-09-27';
const YESTERDAY = '2026-09-26';

function stubStore(days) {
  return { dayEvents: (key) => days[key] || [] };
}

function stubDialogue(entries = []) {
  return { recent: (n) => entries.slice(-n) };
}

function stubSummaries(map = {}) {
  return {
    get: (k) => map[k] || null,
    recent: (n) =>
      Object.entries(map)
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, n)
  };
}

test('意图识别：现在 / 昨天 / 本周', () => {
  assert.equal(builder.detectIntents('我现在在干嘛').wantsNow, true);
  assert.equal(builder.detectIntents('我昨天做了什么').wantsYesterday, true);
  assert.equal(builder.detectIntents('这周怎么样').wantsWeek, true);
  const plain = builder.detectIntents('我刚才在干嘛');
  assert.equal(plain.wantsNow, false);
  assert.equal(plain.wantsYesterday, false);
  assert.equal(plain.wantsWeek, false);
});

test('默认问题：文本分层（L0/L1/L2），不附图片', () => {
  const store = stubStore({
    [TODAY]: [{ ts: 1, time: '09:00', activity: '写代码', app: 'Code', isWorking: true, durationMs: 30 * 60000 }]
  });
  const built = builder.buildQuestionContext({
    question: '我刚才在干嘛',
    store,
    dialogue: stubDialogue([{ role: 'user', kind: 'chat', text: '早' }]),
    summaries: stubSummaries({}),
    now: NOW
  });
  assert.equal(built.attachFreshImage, false);
  assert.ok(built.text.includes('【L2 · 今天事件明细】'));
  assert.ok(built.text.includes('写代码'));
  assert.ok(built.text.includes('【L0 · 最近对话】'));
});

test('「现在/此刻」类问题：才附实时截图', () => {
  const store = stubStore({ [TODAY]: [] });
  const built = builder.buildQuestionContext({
    question: '我现在在干嘛',
    store,
    dialogue: stubDialogue(),
    summaries: stubSummaries(),
    now: NOW
  });
  assert.equal(built.attachFreshImage, true);
});

test('昨天问题：取昨天的明细与摘要层', () => {
  const store = stubStore({
    [TODAY]: [{ ts: 2, time: '10:00', activity: '看视频', app: 'bilibili', isWorking: false }],
    [YESTERDAY]: [{ ts: 1, time: '09:00', activity: '写论文', app: 'Word', isWorking: true, durationMs: 3600000 }]
  });
  const summaries = stubSummaries({ [YESTERDAY]: { text: '昨天主要在写论文。', source: 'cloud' } });
  const built = builder.buildQuestionContext({
    question: '我昨天做了什么',
    store,
    dialogue: stubDialogue(),
    summaries,
    now: NOW
  });
  assert.ok(built.text.includes('写论文'));
  assert.ok(built.text.includes('昨天主要在写论文。'));
});

test('SummaryStore：后写覆盖、读取与清空', () => {
  const dir = mkdtempSync(join(tmpdir(), 'whalepal-test-'));
  const s = new SummaryStore(join(dir, 'summaries.jsonl'));
  assert.equal(s.get(TODAY), null);
  s.put(TODAY, { text: '第一版', source: 'records' });
  s.put(TODAY, { text: '第二版', source: 'cloud' });
  assert.equal(s.get(TODAY).text, '第二版');
  assert.equal(s.get(TODAY).source, 'cloud');
  assert.equal(s.recent(5).length, 1);
  s.clear();
  assert.equal(s.get(TODAY), null);
});

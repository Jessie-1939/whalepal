import test from 'node:test';
import assert from 'node:assert/strict';
import entities from '../src/main/context/entities.js';

const EVENTS = [
  {
    date: '2026-09-27',
    durationMs: 30 * 60000,
    entities: { project: 'whalepal', files: ['engine.js'], keywords: ['调试'] },
    topics: ['调试']
  },
  {
    date: '2026-09-28',
    durationMs: 60 * 60000,
    entities: { project: 'whalepal', files: ['uiText.js'], keywords: ['调试', 'OCR'] },
    topics: ['调试', '论文']
  },
  { date: '2026-09-28', durationMs: 10 * 60000, entities: { project: '论文' }, topics: ['论文'] }
];

test('aggregateEntities：跨天聚合、按天数与次数排序、累计驻留时长', () => {
  const agg = entities.aggregateEntities(EVENTS);
  assert.equal(agg.projects[0].name, 'whalepal');
  assert.equal(agg.projects[0].days, 2);
  assert.equal(agg.projects[0].count, 2);
  assert.equal(agg.projects[0].minutes, 90);
  assert.equal(agg.projects[0].lastDate, '2026-09-28');
  assert.equal(agg.projects[1].name, '论文');
  assert.equal(agg.topics[0].name, '调试');
  assert.equal(agg.topics[0].days, 2);
  assert.deepEqual(agg.files.map((f) => f.name), ['engine.js', 'uiText.js']);
});

test('aggregateEntities：空输入不炸', () => {
  const agg = entities.aggregateEntities([]);
  assert.deepEqual(agg.projects, []);
  assert.deepEqual(agg.topics, []);
});

test('memoryLines：给出项目/主题/文件三行，且控制行数', () => {
  const lines = entities.memoryLines(entities.aggregateEntities(EVENTS));
  assert.ok(lines[0].includes('whalepal（2 天 · 2 次）'));
  assert.ok(lines.some((l) => l.startsWith('主题：')));
  assert.ok(lines.length <= 3);
});

test('buildEntityMemory：按最近 N 天窗口读取并给出提示词文本', () => {
  const store = { readRange: (from, to) => EVENTS.filter((e) => e.date >= from && e.date <= to) };
  const mem = entities.buildEntityMemory(store, { days: 2, now: new Date('2026-09-28T12:00:00') });
  assert.equal(mem.from, '2026-09-27');
  assert.equal(mem.to, '2026-09-28');
  assert.equal(mem.eventCount, 3);
  assert.ok(mem.text.includes('whalepal'));

  const narrow = entities.buildEntityMemory(store, { days: 1, now: new Date('2026-09-28T12:00:00') });
  assert.equal(narrow.eventCount, 2);
});

test('buildEntityMemory：store 不支持 readRange 时安全返回空', () => {
  const mem = entities.buildEntityMemory({ today: () => [] }, { days: 7 });
  assert.equal(mem.eventCount, 0);
  assert.deepEqual(mem.lines, []);
});

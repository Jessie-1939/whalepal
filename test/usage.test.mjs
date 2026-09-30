import test from 'node:test';
import assert from 'node:assert/strict';
import usage from '../src/main/context/usage.js';

test('mergeUsage：token 累计、失败计数、按来源与日期分组', () => {
  const merged = usage.mergeUsage(null, [
    { source: 'analyze', usage: { prompt_tokens: 640, completion_tokens: 80, prompt_cache_hit_tokens: 0 }, dateKey: '2026-09-30' },
    { source: 'analyze', usage: { prompt_tokens: 600, completion_tokens: 60, prompt_cache_hit_tokens: 128 }, dateKey: '2026-09-30' },
    { source: 'ask', usage: { prompt_tokens: 1200, completion_tokens: 160 }, dateKey: '2026-09-30' },
    { source: 'ask', usage: null, failed: true, dateKey: '2026-09-30' }
  ]);
  assert.equal(merged.totals.calls, 4);
  assert.equal(merged.totals.failures, 1);
  assert.equal(merged.totals.prompt, 2440);
  assert.equal(merged.totals.completion, 300);
  assert.equal(merged.totals.cached, 128);
  assert.equal(merged.byDay['2026-09-30'].calls, 4);
  assert.equal(merged.bySource.analyze.prompt, 1240);
  assert.equal(merged.bySource.ask.calls, 2);
  assert.equal(merged.bySource.ask.failures, 1);
});

test('mergeUsage：兼容 prompt/completion/cached 简写，且不修改入参', () => {
  const existing = { totals: { calls: 1, prompt: 10 }, byDay: {}, bySource: {} };
  const before = JSON.stringify(existing);
  const merged = usage.mergeUsage(existing, [
    { source: 'voice', usage: { prompt: 5, completion: 3, cached: 2 }, dateKey: '2026-09-30' }
  ]);
  assert.equal(JSON.stringify(existing), before, 'existing 不应被原地修改');
  assert.equal(merged.totals.calls, 2);
  assert.equal(merged.totals.prompt, 15);
  assert.equal(merged.totals.completion, 3);
  assert.equal(merged.totals.cached, 2);
});

test('mergeUsage：byDay 只保留最近 31 天', () => {
  const records = [];
  for (let i = 0; i < 40; i += 1) {
    // 用真实日期（跨月）而不是拼字符串，保证排序语义正确
    const d = new Date(Date.UTC(2026, 7, 1 + i));
    const day = d.toISOString().slice(0, 10);
    records.push({ source: 'analyze', usage: { prompt_tokens: 1 }, dateKey: day });
  }
  const merged = usage.mergeUsage(null, records);
  const days = Object.keys(merged.byDay);
  assert.equal(days.length, usage.MAX_DAYS);
  assert.ok(!days.includes('2026-08-01'));
  assert.ok(!days.includes('2026-08-09'));
  assert.ok(days.includes('2026-08-10'));
  assert.ok(days.includes('2026-09-09'));
});

test('collector：drain 取走记录且不重复', () => {
  const collector = usage.createUsageCollector();
  collector.record({ source: 'analyze', usage: { prompt_tokens: 5 } });
  collector.record({ source: 'ask', usage: null, failed: true });
  assert.equal(collector.size, 2);
  const first = collector.drain();
  assert.equal(first.length, 2);
  assert.equal(first[0].usage.prompt_tokens, 5);
  assert.equal(first[1].failed, true);
  assert.equal(collector.drain().length, 0);
  assert.equal(collector.size, 0);
});

test('summarizeUsage：取出总量与最近几天', () => {
  const merged = usage.mergeUsage(null, [
    { source: 'analyze', usage: { prompt_tokens: 100 }, dateKey: '2026-09-28' },
    { source: 'analyze', usage: { prompt_tokens: 200 }, dateKey: '2026-09-29' },
    { source: 'ask', usage: { prompt_tokens: 300, completion_tokens: 20 }, dateKey: '2026-09-30' }
  ]);
  const sum = usage.summarizeUsage(merged, { days: 2 });
  assert.equal(sum.totals.prompt, 600);
  assert.deepEqual(sum.recent.map((d) => d.date), ['2026-09-29', '2026-09-30']);
  assert.equal(sum.recent[1].prompt, 300);
});

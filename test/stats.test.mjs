import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStorageStats } from '../src/main/context/stats.js';

test('记忆体积统计：用本机实测基准复算', () => {
  const s = computeStorageStats({
    eventBytes: 9500,
    eventCount: 30,
    imageBytes: 87400,
    intervalSec: 60,
    activeDays: 1
  });
  assert.equal(s.avgEventBytes, 317);
  assert.equal(s.eventsPerDay, 30);
  assert.equal(s.ratioPerEvent, Math.round(87400 / 317));
  // 全量存图：1440 张/天
  assert.equal(s.imagePerDayFull, 1440 * 87400);
  // 去重后按事件存图：30 张/天
  assert.equal(s.imagePerDayDedup, 30 * 87400);
  // 文本记忆一个月的量级远小于图片
  assert.ok(s.textPerMonthBytes < s.imagePerMonthDedup / 100);
});

test('边界：无记录 / 无图片时不产生 NaN', () => {
  const s = computeStorageStats({});
  assert.equal(s.avgEventBytes, 0);
  assert.equal(s.ratioPerEvent, 0);
  assert.equal(s.imagePerMonthFull, 0);
});

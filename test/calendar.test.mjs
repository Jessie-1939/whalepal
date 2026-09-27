import test from 'node:test';
import assert from 'node:assert/strict';
import cal from '../src/main/context/calendar.js';

function evt(ts, time, app, isWorking, durationMs, date) {
  return { ts, time, app, isWorking, durationMs, date };
}

test('aggregateDay：按时长累加、按应用排序、专注时长单独统计', () => {
  const day = '2026-09-27';
  const events = [
    evt(1, '09:00', 'Code', true, 30 * 60000, day),
    evt(2, '09:30', 'Code', true, 0, day), // 无 duration → fallback
    evt(3, '10:00', 'Chrome', false, 20 * 60000, day)
  ];
  const agg = cal.aggregateDay(events, { fallbackMs: 60000 });
  assert.equal(agg.count, 3);
  assert.equal(agg.workingMs, 31 * 60000);
  assert.equal(agg.totalMs, 51 * 60000);
  assert.equal(agg.byApp[0].app, 'Code');
  assert.equal(agg.firstTime, '09:00');
  assert.equal(agg.lastTime, '10:00');
});

test('levelOf：五档强度按专注分钟数', () => {
  assert.equal(cal.levelOf(0), 0);
  assert.equal(cal.levelOf(10 * 60000), 1);
  assert.equal(cal.levelOf(45 * 60000), 2);
  assert.equal(cal.levelOf(120 * 60000), 3);
  assert.equal(cal.levelOf(200 * 60000), 4);
});

test('aggregateMonth：补齐整月、忽略外月事件、统计活跃天数', () => {
  const events = [
    evt(1, '09:00', 'Code', true, 60 * 60000, '2026-09-01'),
    evt(2, '10:00', 'Code', true, 30 * 60000, '2026-09-15'),
    evt(3, '11:00', 'Chrome', false, 10 * 60000, '2026-10-01')
  ];
  const m = cal.aggregateMonth(events, 2026, 9, { fallbackMs: 60000 });
  assert.equal(Object.keys(m.days).length, 30);
  assert.equal(m.days['2026-09-01'].count, 1);
  assert.equal(m.days['2026-09-15'].level, 2);
  assert.equal(m.totals.activeDays, 2);
  assert.equal(m.totals.count, 2);
  assert.equal(m.totals.workingMs, 90 * 60000);
});

test('dayKeyOf：补零正确', () => {
  assert.equal(cal.dayKeyOf(2026, 9, 7), '2026-09-07');
});

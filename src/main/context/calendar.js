/**
 * 日历聚合（纯函数）：把 events.jsonl 的事件按天/按月聚合，
 * 为设置页的「日历热力图」和按天摘要提供数据。
 * 借鉴 MineContext 的 HeatmapService 思路（按天聚合 + 强度分档，Apache-2.0），
 * 但强度按「专注分钟数」分档而不是原始条数。
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

function dayKeyOf(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function localDateKey(d = new Date()) {
  return dayKeyOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** 单条事件的有效时长：优先取驻留时长，缺省按感知间隔估算。 */
function durationMsOf(evt, fallbackMs = 60000) {
  const d = Number(evt?.durationMs);
  return Number.isFinite(d) && d > 0 ? d : fallbackMs;
}

/** 专注分钟 -> 0..4 五档强度（0 / <30min / <90min / <180min / ≥180min）。 */
function levelOf(focusMs) {
  const min = focusMs / 60000;
  if (min <= 0.5) return 0;
  if (min < 30) return 1;
  if (min < 90) return 2;
  if (min < 180) return 3;
  return 4;
}

function aggregateDay(events, { fallbackMs = 60000 } = {}) {
  const sorted = [...(events || [])].sort((a, b) => a.ts - b.ts);
  const byAppMap = new Map();
  let totalMs = 0;
  let workingMs = 0;
  for (const e of sorted) {
    const ms = durationMsOf(e, fallbackMs);
    totalMs += ms;
    if (e.isWorking) workingMs += ms;
    const app = e.app || '未知';
    const cur = byAppMap.get(app) || { app, ms: 0, count: 0 };
    cur.ms += ms;
    cur.count += 1;
    byAppMap.set(app, cur);
  }
  const byApp = [...byAppMap.values()].sort((a, b) => b.ms - a.ms);
  return {
    count: sorted.length,
    totalMs,
    workingMs,
    byApp,
    firstTime: sorted[0]?.time || '',
    lastTime: sorted[sorted.length - 1]?.time || '',
    level: levelOf(workingMs),
    events: sorted
  };
}

function aggregateMonth(events, year, month, { fallbackMs = 60000 } = {}) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const buckets = new Map();
  for (let d = 1; d <= daysInMonth; d++) buckets.set(dayKeyOf(year, month, d), []);
  for (const e of events || []) {
    const bucket = buckets.get(String(e.date || ''));
    if (bucket) bucket.push(e);
  }
  const days = {};
  let totalMs = 0;
  let workingMs = 0;
  let count = 0;
  let activeDays = 0;
  for (const [key, list] of buckets) {
    const agg = aggregateDay(list, { fallbackMs });
    days[key] = {
      count: agg.count,
      totalMs: agg.totalMs,
      workingMs: agg.workingMs,
      level: agg.level,
      topApp: agg.byApp[0]?.app || ''
    };
    totalMs += agg.totalMs;
    workingMs += agg.workingMs;
    count += agg.count;
    if (agg.count > 0) activeDays += 1;
  }
  return { year, month, days, totals: { totalMs, workingMs, activeDays, count } };
}

module.exports = { dayKeyOf, localDateKey, durationMsOf, levelOf, aggregateDay, aggregateMonth };

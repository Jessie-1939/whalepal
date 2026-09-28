/**
 * 跨天实体记忆：把每天事件里的 entities（项目/文件/关键词）与 topics 聚合起来。
 *
 * 为什么需要它：原有的是**事件级记忆**——能答"我刚才/今天在干嘛"；
 * 但答不了"我最近一直在做什么"。实体/主题恰好是跨天稳定、又便宜（纯本地聚合）的线索。
 * 数据来源仍是本地的 data/events.jsonl：不额外落盘、不额外联网、清空记录时一并消失。
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKeyOf(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addTo(map, name, day, minutes) {
  const key = String(name || '').trim();
  if (!key) return;
  const norm = key.toLowerCase();
  let rec = map.get(norm);
  if (!rec) {
    rec = { name: key, count: 0, days: new Set(), minutes: 0, lastDate: '' };
    map.set(norm, rec);
  }
  rec.count += 1;
  if (day) {
    rec.days.add(day);
    if (day > rec.lastDate) rec.lastDate = day;
  }
  if (minutes > 0) rec.minutes += minutes;
}

/** 聚合事件里的实体与主题。跨天排序：先看"出现在多少天"，再看次数。 */
function aggregateEntities(events, { topN = 8 } = {}) {
  const projects = new Map();
  const files = new Map();
  const keywords = new Map();
  const topics = new Map();
  for (const e of events || []) {
    const day = e?.date || '';
    const minutes = Number(e?.durationMs) > 0 ? Math.round(Number(e.durationMs) / 60000) : 0;
    const ent = e?.entities || {};
    if (ent.project) addTo(projects, ent.project, day, minutes);
    for (const f of Array.isArray(ent.files) ? ent.files : []) addTo(files, f, day, minutes);
    for (const k of Array.isArray(ent.keywords) ? ent.keywords : []) addTo(keywords, k, day, minutes);
    for (const t of Array.isArray(e?.topics) ? e.topics : []) addTo(topics, t, day, minutes);
  }
  const top = (map) =>
    [...map.values()]
      .sort((a, b) => b.days.size - a.days.size || b.count - a.count || (a.name < b.name ? -1 : 1))
      .slice(0, topN)
      .map((r) => ({ name: r.name, count: r.count, days: r.days.size, minutes: r.minutes, lastDate: r.lastDate }));
  return { projects: top(projects), files: top(files), keywords: top(keywords), topics: top(topics) };
}

/** 给提示词用的短句（最多 3 行，控制 token）。 */
function memoryLines(agg, { maxLines = 3 } = {}) {
  const lines = [];
  if (agg?.projects?.length) {
    lines.push(
      `最近在做的项目/文档：${agg.projects
        .slice(0, 3)
        .map((p) => `${p.name}（${p.days} 天 · ${p.count} 次）`)
        .join('、')}`
    );
  }
  if (agg?.topics?.length) {
    lines.push(`主题：${agg.topics.slice(0, 4).map((t) => t.name).join('、')}`);
  }
  if (agg?.files?.length) {
    lines.push(`常出现的文件/页面：${agg.files.slice(0, 4).map((f) => f.name).join('、')}`);
  }
  return lines.slice(0, maxLines);
}

/** 从事件库读取最近 N 天并聚合（store 需支持 readRange；测试可传桩）。 */
function buildEntityMemory(store, { days = 7, now = new Date(), topN = 8 } = {}) {
  const to = dateKeyOf(now);
  const from = dateKeyOf(new Date(now.getTime() - (days - 1) * 24 * 3600 * 1000));
  let events = [];
  if (store && typeof store.readRange === 'function') {
    try {
      events = store.readRange(from, to) || [];
    } catch {
      events = [];
    }
  }
  const agg = aggregateEntities(events, { topN });
  const lines = memoryLines(agg);
  return { from, to, days, eventCount: events.length, ...agg, lines, text: lines.join('；') };
}

module.exports = { dateKeyOf, aggregateEntities, memoryLines, buildEntityMemory };

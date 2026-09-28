/**
 * 上下文装配器（分层设计，对齐 OpenViking 的 L0/L1/L2 思路）：
 *   L0 · 对话与概览：最近对话 + 今日 headline
 *   L1 · 每日摘要：今天 / 昨天 / 本周摘要缓存（data/summaries.jsonl）
 *   L1.5 · 实体记忆：最近 7 天的项目/文件/主题聚合（跨天"你最近一直在做什么"）
 *   L2 · 事件明细：今日或指定日期的结构化事件（时间/活动/应用/是否工作/驻留时长）
 *
 * 「图片 vs 文本」的投放规则（本文件是唯一裁决处）：
 *   - 只有需要“看”的问题（现在/此刻/屏幕…）才附一张实时截图；
 *   - 其余问答、摘要、主动搭话全部走文本层（便宜、可检索、少传像素）。
 */

const { buildEntityMemory } = require('./entities');

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKeyOf(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function detectIntents(question) {
  const q = String(question || '');
  return {
    wantsNow: /现在|此刻|正在|当前|眼前|屏幕|桌面|\bnow\b|目前/i.test(q),
    wantsYesterday: /昨天|昨日/.test(q),
    wantsWeek: /这周|本周|这一周|最近几天|近七天|上周|这几天/.test(q)
  };
}

function slimEvent(e) {
  const minutes = Math.round((Number(e.durationMs) > 0 ? Number(e.durationMs) : 0) / 60000);
  const project = e.entities && e.entities.project ? String(e.entities.project).slice(0, 24) : '';
  return {
    time: e.time,
    activity: e.activity,
    app: e.app,
    working: !!e.isWorking,
    // 细节只在存在时进上下文：让「我刚才在干嘛」答得更具体，同时控制 token
    ...(e.detail ? { detail: String(e.detail).slice(0, 48) } : {}),
    ...(project ? { project } : {}),
    ...(minutes > 0 ? { minutes } : {})
  };
}

function buildQuestionContext({ question, store, dialogue, summaries, now = new Date(), maxEvents = 40 }) {
  const intents = detectIntents(question);
  const todayKey = dateKeyOf(now);
  const yesterdayKey = dateKeyOf(new Date(now.getTime() - 24 * 3600 * 1000));
  const blocks = [];

  // L2 · 事件明细（追问昨天时换成昨天的明细）
  const targetKey = intents.wantsYesterday ? yesterdayKey : todayKey;
  const events = (store.dayEvents ? store.dayEvents(targetKey) : []).slice(-maxEvents).map(slimEvent);
  const label = targetKey === todayKey ? '今天' : `${targetKey}（昨天）`;
  blocks.push(`【L2 · ${label}事件明细】${events.length ? JSON.stringify(events) : '（暂无记录）'}`);

  // L1 · 摘要层
  const summaryLines = [];
  if (summaries) {
    const cached = summaries.get(targetKey);
    if (cached) summaryLines.push(`${targetKey} 摘要：${cached.text.replace(/\n+/g, ' ')}`);
    if (intents.wantsWeek) {
      for (const s of summaries.recent(7, todayKey)) {
        summaryLines.push(`${s.date} 摘要：${s.text.replace(/\n+/g, ' ')}`);
      }
    }
  }
  blocks.push(`【L1 · 每日摘要】${summaryLines.length ? summaryLines.join('\n') : '（暂无缓存摘要）'}`);

  // L1.5 · 实体记忆（跨天；纯本地聚合，不额外调用模型）
  let memory = null;
  if (store && typeof store.readRange === 'function') {
    memory = buildEntityMemory(store, { days: 7, now });
  }
  const memoryText = memory && memory.lines.length ? memory.lines.join('\n') : '（暂无跨天积累）';
  blocks.push(`【L1.5 · 实体记忆（最近 7 天，本地聚合）】\n${memoryText}`);

  // L0 · 对话与概览
  const dlg = dialogue
    ? dialogue
        .recent(10)
        .filter((e) => e.kind !== 'skip')
        .map((e) => `${e.role === 'user' ? '主人' : '鲸鱼娘'}：${e.text}`)
        .join('\n')
    : '';
  blocks.push(`【L0 · 最近对话】${dlg || '（还没有对话记录）'}`);

  return {
    intents,
    text: blocks.join('\n'),
    attachFreshImage: intents.wantsNow,
    stats: {
      eventCount: events.length,
      summaryCount: summaryLines.length,
      memoryProjects: memory ? memory.projects.length : 0
    }
  };
}

module.exports = { detectIntents, buildQuestionContext, dateKeyOf };

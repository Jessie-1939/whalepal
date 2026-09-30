/**
 * 云端调用与 token 用量记账（纯函数 + 一个进程内收集器）。
 *
 * 背景：data/usage.json 早期只记「调用次数 / 失败次数」，无法回答"这几天用了多少 token"。
 * 现在每次云端调用都会把响应里的 usage（prompt / completion / cached）记下来，
 * 按「来源 × 日期」汇总到 usage.json，供设置页展示与成本自查。
 *
 * 这里只存数字（token 数 / 次数 / 日期），不含任何屏幕内容或对话原文。
 */

const MAX_DAYS = 31;

/** 空桶。 */
function emptyBucket() {
  return { calls: 0, failures: 0, prompt: 0, completion: 0, cached: 0 };
}

/**
 * 累计单条调用记录：record.usage 为 null 表示这次调用没有拿到（或没有）usage。
 * usage 同时接受两种写法：API 原始字段（prompt_tokens / completion_tokens /
 * prompt_cache_hit_tokens）与归一化短字段（prompt / completion / cached）。
 */
function addRecord(bucket, record) {
  if (!bucket) return bucket;
  bucket.calls += 1;
  if (record?.failed) bucket.failures += 1;
  const u = record?.usage;
  if (u) {
    bucket.prompt += Number(u.prompt ?? u.prompt_tokens ?? 0) || 0;
    bucket.completion += Number(u.completion ?? u.completion_tokens ?? 0) || 0;
    bucket.cached += Number(u.cached ?? u.prompt_cache_hit_tokens ?? u.cached_tokens ?? 0) || 0;
  }
  return bucket;
}

/**
 * 把一批调用记录并入 totals / byDay / bySource。
 * 纯函数：返回新对象，不修改入参。byDay 只保留最近 MAX_DAYS 天。
 */
function mergeUsage(existing, records, { dateKey = '' } = {}) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const totals = { ...emptyBucket(), ...(base.totals || {}) };
  const byDay = { ...(base.byDay || {}) };
  const bySource = { ...(base.bySource || {}) };

  for (const record of Array.isArray(records) ? records : []) {
    if (!record) continue;
    const day = String(record.dateKey || dateKey || 'unknown');
    const source = String(record.source || 'analyze');
    addRecord(totals, record);
    byDay[day] = addRecord({ ...emptyBucket(), ...(byDay[day] || {}) }, record);
    bySource[source] = addRecord({ ...emptyBucket(), ...(bySource[source] || {}) }, record);
  }

  const days = Object.keys(byDay).sort();
  for (const stale of days.slice(0, Math.max(0, days.length - MAX_DAYS))) delete byDay[stale];

  return { ...base, totals, byDay, bySource };
}

/**
 * 进程内收集器：云端模块（analyzer / chat / proactive / voice）只管往里塞记录，
 * ContextEngine 每轮结束后 drain 一次并落盘。
 * 这样调用方与被调用方之间不需要互相 require，避免循环依赖。
 */
function createUsageCollector() {
  let pending = [];
  return {
    record({ source = 'analyze', usage = null, failed = false, dateKey = '' } = {}) {
      // 原样保存 usage 对象（数字提取交给 addRecord 统一处理，避免两处口径漂移）
      const u = usage && typeof usage === 'object' ? { ...usage } : null;
      pending.push({ source, usage: u, failed: failed === true, dateKey });
    },
    drain() {
      const out = pending;
      pending = [];
      return out;
    },
    get size() {
      return pending.length;
    }
  };
}

/** 用量摘要（设置页/统计用）：总量 + 最近几天。 */
function summarizeUsage(raw, { days = 3 } = {}) {
  const totals = { ...emptyBucket(), ...(raw?.totals || {}) };
  const byDay = raw?.byDay || {};
  const recent = Object.keys(byDay).sort().slice(-Math.max(1, days))
    .map((date) => ({ date, ...emptyBucket(), ...byDay[date] }));
  return { totals, recent };
}

module.exports = { MAX_DAYS, emptyBucket, addRecord, mergeUsage, createUsageCollector, summarizeUsage };


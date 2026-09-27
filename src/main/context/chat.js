/**
 * 上下文问答与今日摘要。
 * - 有云端模型：带人设（persona.js）与对话记忆（dialogue.js）交给模型组织语言；
 * - 无模型 / 调用失败：基于本地事件记录做模板化整理（这不是模型分析）。
 */
const { personaSystemPrompt } = require('./persona');

async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 底层调用：POST {baseUrl}/chat/completions，返回解析后的响应 JSON（支持 tools 等任意参数）。 */
async function chatCompletion(payload, cfg, { timeoutMs = 20000 } = {}) {
  const base = String(cfg.model.baseUrl || '').replace(/\/+$/, '');
  const resp = await fetchWithTimeout(
    `${base}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.model.apiKey}` },
      body: JSON.stringify(payload)
    },
    timeoutMs
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 160)}`);
  }
  return resp.json();
}

async function cloudChat(messages, cfg, { timeoutMs = 20000, temperature = 0.5 } = {}) {
  const data = await chatCompletion({ model: cfg.model.model, temperature, messages }, cfg, { timeoutMs });
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('云端返回为空');
  return String(content).trim();
}

function slimEvents(events) {
  return events.map((e) => ({
    time: e.time,
    activity: e.activity,
    category: e.category,
    app: e.app,
    working: !!e.isWorking
  }));
}

function dialogueLines(dialogue, n = 12) {
  if (!dialogue) return '（还没有对话记录）';
  const lines = dialogue
    .recent(n)
    .filter((e) => e.kind !== 'skip')
    .map((e) => `${e.role === 'user' ? '主人' : '鲸鱼娘'}：${e.text}`);
  return lines.join('\n') || '（还没有对话记录）';
}

function topApps(today, limit = 3) {
  const byApp = {};
  for (const e of today) {
    const app = e.app || '未知';
    byApp[app] = (byApp[app] || 0) + 1;
  }
  return Object.entries(byApp)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function recordsSummary(store) {
  const today = store.today();
  if (!today.length) return '今天我还没有观察到什么活动～等你开始忙起来，我就有记录啦。';
  const first = today[0];
  const last = today[today.length - 1];
  const working = today.filter((e) => e.isWorking).length;
  const apps = topApps(today)
    .map(([a, c]) => `${a}×${c}`)
    .join('、');
  const lines = [
    `📅 今天一共记录了 ${today.length} 个片段，从 ${first.time} 到 ${last.time}。`,
    `🖥️ 主要应用：${apps || '暂无明显集中'}。`,
    `💪 其中专注片段 ${working} 个${working ? '，今天的投入很扎实。' : '，今天以休息为主。'}`,
    last.note ? `👀 最近一次观察：${last.note}` : ''
  ];
  return lines.filter(Boolean).join('\n');
}

function recordsAnswer(question, store) {
  const q = String(question || '').trim();
  // 人设规则：绝不被说胖（TRAIT_NOT_FAT_REFUSE）
  if (/胖|肥|圆润|圆了/.test(q)) {
    return '哼！鲸鱼娘才不胖，只是毛茸茸而已。（甩甩尾巴）……再说就不理你了。';
  }
  const today = store.today();
  if (!today.length) {
    return '我今天还没记录到活动呢。等你忙起来，再来问我「刚才在干嘛」就有答案了～';
  }
  if (/你好|在吗|hi|hello/i.test(q)) {
    return `我在的！今天陪你记录了 ${today.length} 个片段，最近一次是：${today[today.length - 1].activity}。`;
  }
  if (/多久|多长时间|忙了/.test(q)) {
    const working = today.filter((e) => e.isWorking).length;
    return `今天有 ${working} 个专注片段被记录下来（按每次感知的间隔估算，仅供参考）。注意劳逸结合呀。`;
  }
  const head = /总结|摘要|日报|怎么样|干了啥|做了什么|干啥/.test(q)
    ? '给你今天的整体情况：'
    : '我记录到的情况是这样的：';
  return `${head}\n${recordsSummary(store)}`;
}

async function cloudAnswer(question, store, cfg, dialogue) {
  const recent = slimEvents(store.readRecent(24));
  const today = slimEvents(store.today().slice(-40));
  const messages = [
    {
      role: 'system',
      content: `${personaSystemPrompt({ userName: cfg.companion.name, selfName: cfg.companion.selfName })}

【任务】根据主人的屏幕活动记录回答问题。回答不超过 120 字；不要编造记录里没有的事；记录不足时直说并给一个小建议；不要重复你最近刚刚说过的话；如果之前问过的问题主人没有回应，不要再追问。`
    },
    {
      role: 'user',
      content: `今日记录：${JSON.stringify(today)}\n最近记录：${JSON.stringify(recent)}\n最近对话：\n${dialogueLines(dialogue)}\n\n问题：${question}`
    }
  ];
  return cloudChat(messages, cfg);
}

async function ask(question, { store, cfg, dialogue }) {
  const q = String(question || '').trim();
  if (!q) return { answer: '你想问什么都可以，比如「我刚才在干嘛」。', source: 'records' };
  const cloudReady = !!(cfg?.model?.apiKey && cfg?.model?.model && cfg?.model?.baseUrl);
  if (cloudReady) {
    try {
      return { answer: await cloudAnswer(q, store, cfg, dialogue), source: 'cloud' };
    } catch (err) {
      return {
        answer: `${recordsAnswer(q, store)}\n\n（云端模型暂时联系不上：${String(err?.message || err).slice(0, 80)}）`,
        source: 'records'
      };
    }
  }
  return { answer: recordsAnswer(q, store), source: 'records' };
}

async function cloudSummary(store, cfg, dialogue) {
  const today = slimEvents(store.today().slice(-60));
  const messages = [
    {
      role: 'system',
      content: `${personaSystemPrompt({ userName: cfg.companion.name, selfName: cfg.companion.selfName })}

【任务】把主人今天的屏幕活动记录整理成 3-6 条中文要点（可用 emoji 开头），覆盖：时间线、专注时长体感、主要应用分布、一句温柔的提醒。不要编造记录外的事实，不超过 200 字。`
    },
    { role: 'user', content: `今日记录：${JSON.stringify(today)}\n最近对话：\n${dialogueLines(dialogue, 8)}` }
  ];
  return cloudChat(messages, cfg, { temperature: 0.4 });
}

async function summary({ store, cfg, dialogue }) {
  const cloudReady = !!(cfg?.model?.apiKey && cfg?.model?.model && cfg?.model?.baseUrl);
  if (cloudReady) {
    try {
      return { text: await cloudSummary(store, cfg, dialogue), source: 'cloud' };
    } catch (err) {
      return {
        text: `${recordsSummary(store)}\n\n（云端模型暂时联系不上：${String(err?.message || err).slice(0, 80)}）`,
        source: 'records'
      };
    }
  }
  return { text: recordsSummary(store), source: 'records' };
}

async function testModel(cfg) {
  if (!cfg?.model?.apiKey) return { ok: false, error: '未填写 API Key' };
  const t0 = Date.now();
  try {
    const reply = await cloudChat([{ role: 'user', content: '只回复两个字：在的' }], cfg, { timeoutMs: 15000, temperature: 0 });
    return { ok: true, latencyMs: Date.now() - t0, reply: reply.slice(0, 40) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 200), latencyMs: Date.now() - t0 };
  }
}

module.exports = {
  chatCompletion,
  ask,
  summary,
  testModel,
  recordsSummary,
  recordsAnswer,
  cloudChat,
  dialogueLines
};

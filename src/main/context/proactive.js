/**
 * 主动搭话：默认沉默，只有云端模型显式调用 send_message 工具才会发送。
 * 门控（evaluateProactiveGates，纯函数）负责：安静时段、工作状态、冷却、
 * 未回应处理（TIMEOUT_SIGNAL 只发一次）、无活动不发、无云端 Key 不发。
 */
const { personaSystemPrompt } = require('./persona');
const { chatCompletion, cloudChat } = require('./chat');
const { inQuietHours } = require('./notes');

const MIN_GAP_MS = 12 * 60 * 1000; // 两次主动消息最小间隔
const TIMEOUT_MS = 4 * 60 * 1000; // 主动消息多久没回应算「未回应」
const NO_ACTIVITY_MS = 30 * 60 * 1000; // 主人半小时没有活动就不再判断

const TIMEOUT_LINE = '……主人？（尾巴轻轻拍了下桌面）在忙的话，就当我没说。';

/**
 * 纯函数门控。
 * @returns {{allow:boolean, mode?:'model'|'timeout', reason:string}}
 */
function evaluateProactiveGates({ cfg, now, hour, lastEvent, dialogue, hasKey }) {
  if (!cfg?.companion?.proactive) return { allow: false, reason: 'disabled' };
  if (!cfg?.companion?.bubbles) return { allow: false, reason: 'bubbles-off' };
  if (!cfg?.companion?.visible) return { allow: false, reason: 'hidden' };
  if (inQuietHours(hour, cfg?.companion?.quietHours)) return { allow: false, reason: 'quiet' };
  if (!lastEvent || now - lastEvent.ts > NO_ACTIVITY_MS) return { allow: false, reason: 'no-activity' };
  if (lastEvent.isWorking) return { allow: false, reason: 'working' };

  const lastProactive = dialogue.lastOfKind(['proactive', 'timeout']);
  const lastUser = dialogue.lastOfRole('user');
  const unanswered = !!lastProactive && (!lastUser || lastUser.ts < lastProactive.ts);

  if (unanswered) {
    const lastTimeout = dialogue.lastOfKind('timeout');
    const timeoutAfter = !!lastTimeout && lastTimeout.ts >= lastProactive.ts;
    if (!timeoutAfter && now - lastProactive.ts >= TIMEOUT_MS) {
      return { allow: true, mode: 'timeout', reason: 'timeout-signal' };
    }
    return { allow: false, reason: 'awaiting-user' };
  }

  if (lastProactive && now - lastProactive.ts < MIN_GAP_MS) return { allow: false, reason: 'cooldown' };
  if (!hasKey) return { allow: false, reason: 'no-cloud-key' };
  return { allow: true, mode: 'model', reason: 'ok' };
}

/** 仅供云端模型使用的工具：发送 / 保持沉默。不调用 send_message 就绝不发送。 */
const PROACTIVE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'send_message',
      description:
        '向桌面上的主人发一条主动消息。只在确实值得打扰、且与最近说过的话不重复时调用。',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '简体中文，不超过 60 字，符合鲸鱼娘人设（傲娇但甜），不重复最近说过的话'
          }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stay_silent',
      description: '保持沉默（默认选择）。没有新鲜、值得关心或能帮上忙的内容时调用。',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string', description: '一句简短的沉默理由' } },
        required: []
      }
    }
  }
];

function slimEvents(events) {
  return events.map((e) => ({ time: e.time, activity: e.activity, category: e.category, app: e.app, working: !!e.isWorking }));
}

function buildPromptMessages({ cfg, store, dialogue, now, trial = false, memory = '' }) {
  const recentEvents = slimEvents(store.readRecent(8));
  const lastEvent = store.readRecent(1)[0] || null;
  const lines = dialogue
    .recent(12)
    .filter((e) => e.kind !== 'skip')
    .map((e) => `${e.role === 'user' ? '主人' : '鲸鱼娘'}：${e.text}`);
  const system = `${personaSystemPrompt({
    userName: cfg.companion.name,
    selfName: cfg.companion.selfName
  })}

【任务】判断此刻是否值得主动对主人说一句话。
${trial ? '【本次为主人手动触发】请直接调用 send_message 送出一句贴合当下情境的关心或观察（不要与最近说过的话重复）。\n' : ''}规则：
1) 主人正在专注工作时保持沉默；
2) 没有新的变化、没有值得关心的内容时保持沉默；
3) 不要重复最近说过的话；之前问过而主人没回应的问题，不要再问；
4) 意象克制：「尾巴」类小动作平均每 5 条最多出现 1 次，不要连续两条用同一个梗；
5) 如果决定发送，必须调用 send_message 工具；否则调用 stay_silent。`;
  const user = [
    `现在时间：${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    `当前状态：${lastEvent ? `${lastEvent.activity}（${lastEvent.category}，${lastEvent.isWorking ? '工作中' : '空闲'}）` : '未知'}`,
    `最近事件：${JSON.stringify(recentEvents)}`,
    ...(memory ? [`最近在忙（跨天实体记忆，可自然引用）：${memory}`] : []),
    `最近对话（倒序看最近）：\n${lines.join('\n') || '（还没有对话记录）'}`
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

/** 云端判定：返回 {send, text?, reason}。任何异常都视为保持沉默。 */
async function decideWithModel({ cfg, store, dialogue, now = new Date(), trial = false, memory = '' }) {
  try {
    const data = await chatCompletion(
      {
        model: cfg.model.model,
        temperature: 0.6,
        messages: buildPromptMessages({ cfg, store, dialogue, now, trial, memory }),
        tools: PROACTIVE_TOOLS,
        tool_choice: 'auto'
      },
      cfg,
      { timeoutMs: 20000, source: 'proactive' }
    );
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call || call.function?.name !== 'send_message') {
      return { send: false, reason: call?.function?.name === 'stay_silent' ? 'model-silent' : 'no-tool-call' };
    }
    let args = {};
    try {
      args = JSON.parse(call.function.arguments || '{}');
    } catch {
      args = {};
    }
    const text = String(args.text || '').trim().slice(0, 120);
    if (!text) return { send: false, reason: 'empty-args' };
    const recentPet = dialogue.recent(20).filter((e) => e.role === 'pet').map((e) => e.text);
    if (recentPet.includes(text)) return { send: false, reason: 'duplicate' };
    return { send: true, text };
  } catch (err) {
    return { send: false, reason: 'cloud-error', error: String(err?.message || err).slice(0, 120) };
  }
}

/**
 * 手动试跑（设置 → 对话 →「让她现在说一句」）：
 * 主人明确要求她说话时，直接生成一句贴合当下情境的话——
 * 而不是再走一遍"要不要开口"的工具门控（那是给自主搭话用的）。
 */
async function generateTrialLine({ cfg, store, dialogue, now = new Date(), memory = '' }) {
  const recentEvents = slimEvents(store.readRecent(8));
  const lines = dialogue
    .recent(8)
    .filter((e) => e.kind !== 'skip')
    .map((e) => `${e.role === 'user' ? '主人' : '鲸鱼娘'}：${e.text}`);
  const messages = [
    {
      role: 'system',
      content: `${personaSystemPrompt({ userName: cfg.companion.name, selfName: cfg.companion.selfName })}

【任务】主人手动点击了「让她现在说一句」。请直接输出一句主动关心或观察：
≤40 字、简体中文、贴合下面给出的最近情境、不要与最近说过的话重复（尾巴类小动作平均每 5 句最多 1 次）；
只输出这句话本身，不要引号、不要解释、不要任何前后缀。`
    },
    {
      role: 'user',
      content: `最近事件：${JSON.stringify(recentEvents)}${memory ? `\n最近在忙：${memory}` : ''}\n最近对话：\n${lines.join('\n') || '（暂无）'}\n现在时间：${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    }
  ];
  const text = await cloudChat(messages, cfg, { temperature: 0.8, timeoutMs: 20000, source: 'proactive' });
  return String(text).trim().replace(/^["'“”]+|["'“”]+$/g, '').slice(0, 80);
}

module.exports = {
  MIN_GAP_MS,
  TIMEOUT_MS,
  TIMEOUT_LINE,
  PROACTIVE_TOOLS,
  inQuietHours,
  evaluateProactiveGates,
  buildPromptMessages,
  decideWithModel,
  generateTrialLine
};

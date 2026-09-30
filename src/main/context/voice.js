/**
 * 「她说什么」的唯一出口。
 *
 * 设计原则（按主人要求）：**正常情况下完全由 LLM 驱动**——摸头、投喂、被戳、关怀提醒、
 * 报错/完成的反应、开启时的问候，全部由云端模型结合当下情境现写；
 * 内置台词库（renderer/core/lines.js）只在**没有配 Key / 断网 / 调用失败**时兜底。
 *
 * 唯一的技术性护栏：同一类互动 4 秒内只请求一次（防止连点刷接口），命中缓存时复用上一句。
 */
const { personaSystemPrompt } = require('./persona');
const { cloudChat } = require('./chat');
const { Lines, greetingFor, pick } = require('../../renderer/core/lines.js');

/** 触发类型 → 给模型的说明 + 显示时长。 */
const KINDS = {
  'pat-head': { desc: '主人摸了摸你的头', ms: 4500 },
  'pat-belly': { desc: '主人戳了戳你的肚子', ms: 4500 },
  'pat-tail': { desc: '主人碰了碰你的尾巴', ms: 4500 },
  triple: { desc: '主人连着点了你三次', ms: 6000 },
  feed: { desc: '主人投喂了你一份小点心', ms: 5000 },
  praise: { desc: '主人夸了夸你', ms: 5000 },
  poke: { desc: '主人戳了你一下（你有点小生气）', ms: 5000 },
  'care-sitting': { desc: '主人已经连续工作很久了，提醒他起来活动一下', ms: 7000 },
  'care-night': { desc: '已经很晚了主人还在忙，劝他去休息', ms: 7000 },
  'care-welcome': { desc: '主人离开了一会儿又回来了，打个招呼', ms: 7000 },
  'signal-error': { desc: '屏幕上出现了报错，安慰一下主人', ms: 8000 },
  'signal-success': { desc: '主人刚完成了一件事，替他高兴一下', ms: 6000 },
  greeting: { desc: '主人刚打开电脑，打个招呼', ms: 5200 },
  spawn: { desc: '你刚出现在桌面上，说一句开场白', ms: 4000 },
  chatter: { desc: '这会儿比较闲，随便找个轻松的话题说一句', ms: 5000 }
};

const COOLDOWN_MS = 4000;
const lastAt = new Map();
const lastText = new Map();

function msFor(kind) {
  return (KINDS[kind] && KINDS[kind].ms) || 5000;
}

/** 本地兜底：直接取台词库（与渲染层同一份文件，保证断网时语气一致）。 */
function localLine(kind, hour = new Date().getHours()) {
  if (kind === 'pat-head' || kind === 'pat-belly' || kind === 'pat-tail') {
    return pick(Lines.interaction[kind.slice(4)]) || '';
  }
  if (kind === 'triple') return pick(Lines.triple);
  if (kind === 'feed') return pick(Lines.feed);
  if (kind === 'praise') return pick(Lines.praise);
  if (kind === 'poke') return pick(Lines.poke);
  if (kind && kind.startsWith('care-')) return pick(Lines.care[kind.slice(5)]) || '';
  if (kind === 'signal-error') return pick(Lines.signal.error);
  if (kind === 'signal-success') return pick(Lines.signal.success);
  if (kind === 'greeting') return pick(greetingFor(hour));
  if (kind === 'spawn') return pick(Lines.spawn);
  if (kind === 'asked') return pick(Lines.asked);
  return pick(Lines.context.other);
}

/** 给模型的消息（纯函数，便于单测）：人设 + 触发 + 当下状态 + 最近对话。 */
function buildVoiceMessages({ kind, cfg, store, dialogue, now = new Date() }) {
  const meta = KINDS[kind] || { desc: kind || '主人和你互动了一下' };
  const lastEvent = store && typeof store.readRecent === 'function' ? store.readRecent(1)[0] : null;
  const recentEvents = store && typeof store.readRecent === 'function' ? store.readRecent(5) : [];
  const lines = dialogue
    ? dialogue
        .recent(10)
        .filter((e) => e.kind !== 'skip')
        .map((e) => `${e.role === 'user' ? '主人' : '鲸鱼娘'}：${e.text}`)
        .join('\n')
    : '';
  const system = `${personaSystemPrompt({
    userName: cfg?.companion?.name || '主人',
    selfName: cfg?.companion?.selfName || '鲸鱼娘'
  })}

【任务】主人刚刚做了这件事：${meta.desc}。请用你自己的口吻回一句。
要求：≤30 字、贴合当前情境、不要和最近说过的话重复（换个说法、换个意象）；
只输出这句话本身，不要引号、不要解释、不要括号里的舞台提示。`;
  const user = [
    `现在时间：${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    `主人此刻在做什么：${lastEvent ? `${lastEvent.activity || ''}${lastEvent.detail ? `（${lastEvent.detail}）` : ''}` : '未知'}`,
    `最近的屏幕片段：${JSON.stringify(
      recentEvents.map((e) => ({ time: e.time, activity: e.activity, app: e.app, working: !!e.isWorking }))
    )}`,
    `最近对话：\n${lines || '（还没有对话记录）'}`
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

/**
 * 生成一句台词。
 * @returns {Promise<{text:string, source:'cloud'|'local'|'cache'}>}
 */
async function composeLine({ kind = '', cfg, store, dialogue, fallback = '', now = Date.now() }) {
  const hour = new Date(now).getHours();
  const local = fallback || localLine(kind, hour);
  const cloudReady = !!(cfg?.model?.apiKey && cfg?.model?.model && cfg?.model?.baseUrl);
  if (!cloudReady) return { text: local, source: 'local' };
  const prevAt = lastAt.get(kind) || 0;
  if (kind && now - prevAt < COOLDOWN_MS && lastText.has(kind)) {
    return { text: lastText.get(kind), source: 'cache' };
  }
  try {
    const text = await cloudChat(buildVoiceMessages({ kind, cfg, store, dialogue, now: new Date(now) }), cfg, {
      temperature: 0.95,
      timeoutMs: 12000,
      source: 'voice'
    });
    const clean = String(text || '').trim().replace(/^["'“”]+|["'“”]+$/g, '').slice(0, 60);
    if (!clean) return { text: local, source: 'local' };
    if (kind) {
      lastAt.set(kind, now);
      lastText.set(kind, clean);
    }
    return { text: clean, source: 'cloud' };
  } catch {
    return { text: local, source: 'local' };
  }
}

module.exports = { KINDS, COOLDOWN_MS, msFor, localLine, buildVoiceMessages, composeLine };

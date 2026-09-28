/**
 * 观察台词（note）的两件事：**新不新鲜** 与 **该不该说出口**。
 *
 * 背景（主人反馈）：
 *  1. 「很少看到她显示回答」——此前 note 只写进事件、在设置页显示，桌面上从不开口；
 *  2. 「老是重复摇尾巴」——MODE_TAIL_FLUKES 人设下模型每条观察都写尾巴。
 *
 * 这里的策略：模型给的观察先过 ensureFreshNote（与最近 5 条太像 / 尾巴用太多 → 换本地台词池），
 * 再由 shouldSpeakNote 决定要不要在桌面上说出来（有节流、有去重、尊重安静时段与开关）。
 */

const TAIL_RE = /尾巴|尾鳍|甩尾|摇尾|尾尖/;

/** 本地兜底台词池：按类别给 3-4 句，主要写具体观察，尾巴只做点缀（见 TAIL_LINES 的 8% 概率）。 */
const LOCAL_NOTES = {
  coding: [
    '这段逻辑绕来绕去，你倒是挺有耐心的。',
    '又在敲代码呀，我把声音放轻一点。',
    '别人写代码会暴躁，你只是皱眉头，还行嘛。',
    '报错红了别急着砸键盘，我陪你一起看。'
  ],
  terminal: [
    '命令跑着呢，先喝口水等结果。',
    '终端刷得飞快，我虽然看不懂，但很帅。',
    '别紧张，这种小问题你十分钟就能搞定。'
  ],
  office: [
    '表格越拉越长，眼睛记得歇一歇。',
    '排版这种活儿，最能看出一个人的审美。',
    '这一段处理得挺认真嘛，我都看进去了。'
  ],
  writing: [
    '写下来的东西都算数，别嫌慢。',
    '这句话改了好几遍吧？值。',
    '灵感来了就先写，别管好不好。'
  ],
  design: [
    '留白多一点，别急着塞满。',
    '又在调那一个像素的间距了？我懂。',
    '退后一步看全局，你会更满意。'
  ],
  meeting: [
    '开会中，我安静待着。',
    '会议结束记得站起来走两步。',
    '听别人讲的时候，也顺手记一句重点。'
  ],
  reading: [
    '看资料看得真专注，我都不好意思打断。',
    '重点划一划，回头好找。',
    '这一页有点密，慢慢看。'
  ],
  video: [
    '摸鱼时间到，理直气壮一点。',
    '看吧看吧，我陪你一起。',
    '笑点这么低，也太好养了。'
  ],
  chat: [
    '聊得挺投入嘛，我先不插嘴。',
    '社交也是要做功课的，理解。',
    '回消息别太急，你又不是客服。'
  ],
  browsing: [
    '网页开了一排，注意别走丢。',
    '查资料记得顺手收拢线索。',
    '又点开一个新标签页了，我数着呢。'
  ],
  gaming: [
    '玩得开心，我就在旁边看着。',
    '这局稳住，能赢的。',
    '输了也别骂人，我听着呢。'
  ],
  idle: [
    '桌面安静下来了，我也发会儿呆。',
    '这会儿不忙的话，喝口水吧。',
    '嗯……我就静静待着。'
  ],
  other: [
    '在忙什么我未必懂，但我在。',
    '继续忙你的，我负责陪着。',
    '不打扰你，就是让你知道我在。'
  ]
};

/** 尾巴台词单独放，低概率抽取：既不消失（人设如此），也不会每句都来。 */
const TAIL_LINES = ['（甩甩尾巴）……别看我，继续忙你的。', '哼，尾巴替你数着时间呢。', '尾巴轻轻拍了下桌子，算是应你了。'];

function normalize(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[，。！？~～、,.!?;；:：（）()【】\[\]"'“”]/g, '');
}

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 字符二元组 Jaccard 相似度（0-1）。用于判断"是不是又说了一遍同样的话"。 */
function similarity(a, b) {
  const x = bigrams(normalize(a));
  const y = bigrams(normalize(b));
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const g of x) if (y.has(g)) inter++;
  return inter / (x.size + y.size - inter);
}

function pickFrom(pool, rng) {
  const r = typeof rng === 'function' ? rng() : Math.random();
  return pool[Math.floor(r * pool.length) % pool.length];
}

/** 本地兜底：优先挑与最近台词不相似的；尾巴句只在最近 5 条都没用过尾巴时以 8% 概率出现。 */
function pickLocalNote(category, { rng = Math.random, avoid = [] } = {}) {
  const recent = (avoid || []).filter(Boolean).slice(-5);
  const tailFresh = !recent.some((r) => TAIL_RE.test(r));
  if (tailFresh && rng() < 0.08) return pickFrom(TAIL_LINES, rng);
  const pool = LOCAL_NOTES[category] || LOCAL_NOTES.other;
  const fresh = pool.filter((line) => !recent.some((r) => similarity(line, r) >= 0.5));
  return pickFrom(fresh.length ? fresh : pool, rng);
}

/**
 * 保证观察新鲜：与最近 5 条太像（≥0.55）或尾巴在最近 5 条里已出现 ≥2 次却又写了尾巴 → 换本地台词。
 * 完全没内容时也走本地兜底。
 */
function ensureFreshNote(note, recent = [], { category = 'other', rng = Math.random } = {}) {
  const text = String(note || '').trim();
  const recentList = (recent || []).filter(Boolean).slice(-5);
  const tooSimilar = !!text && recentList.some((r) => similarity(text, r) >= 0.55);
  const tailOverused = !!text && TAIL_RE.test(text) && recentList.filter((r) => TAIL_RE.test(r)).length >= 2;
  if (text && !tooSimilar && !tailOverused) return text;
  return pickLocalNote(category, { rng, avoid: recentList });
}

function inQuietHours(hour, quiet = { start: 23, end: 6 }) {
  const { start, end } = quiet || {};
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * 这条观察该不该在桌面上说出口（纯函数）。
 * 工作时段间隔 8 分钟、其余 3 分钟；与最近说过的任何一句太像都不说。
 */
function shouldSpeakNote({
  cfg,
  evt,
  now = Date.now(),
  hour = new Date(now).getHours(),
  lastNoteAt = 0,
  recentPetLines = [],
  workingGapMs = 8 * 60 * 1000,
  idleGapMs = 3 * 60 * 1000
} = {}) {
  const note = evt && evt.note ? String(evt.note).trim() : '';
  if (!note) return { speak: false, reason: 'no-note' };
  if (!cfg?.companion?.bubbles) return { speak: false, reason: 'bubbles-off' };
  if (!cfg?.companion?.visible) return { speak: false, reason: 'hidden' };
  if (cfg?.companion?.speakNotes === false) return { speak: false, reason: 'notes-off' };
  if (inQuietHours(hour, cfg?.companion?.quietHours)) return { speak: false, reason: 'quiet' };
  const gap = evt.isWorking ? workingGapMs : idleGapMs;
  if (lastNoteAt && now - lastNoteAt < gap) return { speak: false, reason: 'cooldown' };
  if ((recentPetLines || []).some((t) => String(t).trim() === note || similarity(t, note) >= 0.6)) {
    return { speak: false, reason: 'duplicate' };
  }
  return { speak: true, reason: 'ok' };
}

module.exports = {
  TAIL_RE,
  LOCAL_NOTES,
  TAIL_LINES,
  similarity,
  pickLocalNote,
  ensureFreshNote,
  inQuietHours,
  shouldSpeakNote
};

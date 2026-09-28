/**
 * 屏幕理解：模型分析全部走云端（OpenAI 兼容接口）。
 * 未配置 API Key 或云端调用失败时，退化为「基础感知」——仅依据前台窗口标题/进程名做关键词分类，
 * 这是非模型的降级路径，保证桌宠状态联动不至于完全不可用。
 */

const WORKING = new Set(['coding', 'office', 'writing', 'design', 'meeting', 'reading', 'terminal']);
const { guardedFetch } = require('./net');
const CATEGORIES = new Set([
  'coding', 'office', 'writing', 'design', 'meeting', 'reading',
  'video', 'chat', 'browsing', 'gaming', 'terminal', 'idle', 'other'
]);

const RULES = [
  ['coding', ['visual studio code', 'vscode', 'cursor', 'pycharm', 'intellij', 'idea', 'webstorm', 'goland', 'clion', 'rider', 'datagrip', 'android studio', 'xcode', 'devenv', 'code.exe', 'sublime', 'notepad++', 'neovim', 'vim', 'emacs', 'matlab', 'simulink', 'eclipse', 'deveco', 'arduino']],
  ['terminal', ['windowsterminal', 'windows terminal', 'powershell', 'pwsh', 'cmd.exe', 'conhost', 'wsl', 'git-bash', 'mintty', 'terminal', '命令提示符']],
  ['office', ['winword', 'word', 'excel', 'powerpnt', 'powerpoint', 'wps', 'onenote', 'outlook', 'keynote', 'numbers', 'pages']],
  ['writing', ['typora', 'obsidian', 'notion', '语雀', '印象笔记', 'onenote']],
  ['reading', ['acrord', 'adobe reader', 'sumatra', 'foxit', 'calibre', 'zotero', 'pdf']],
  ['design', ['photoshop', 'illustrator', 'figma', 'blender', 'maya', '3ds max', 'autocad', 'sketch', 'adobexd', 'cad']],
  ['meeting', ['zoom', 'teams', 'tencent meeting', '腾讯会议', 'webex', 'meet.google']],
  ['chat', ['wechat', '微信', 'qq', 'telegram', 'discord', 'slack', 'feishu', '飞书', 'dingtalk', '钉钉', '企业微信']],
  ['video', ['potplayer', 'vlc', 'mpv', 'mpc-hc', 'bilibili', '哔哩哔哩', 'youku', '优酷', 'iqiyi', '爱奇艺', 'netflix', 'youtube']],
  ['gaming', ['steam', 'epic games', 'league of legends', 'valorant', 'genshin', '原神', 'minecraft', '崩坏', '王者荣耀', '游戏']],
  ['browsing', ['chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera', '360se', 'qqbrowser', 'safari', 'arc']]
];

const ACTIVITY_TEXT = {
  coding: '编写代码',
  office: '处理文档/表格',
  writing: '写作/记录',
  design: '做设计',
  meeting: '开会',
  reading: '阅读资料',
  video: '看视频',
  chat: '聊天/沟通',
  browsing: '浏览网页',
  gaming: '玩游戏',
  terminal: '跑命令/调试',
  idle: '暂时空闲',
  other: '日常操作'
};

const NOTES = {
  coding: ['看起来进入状态了，键盘敲得很稳。', '这段代码像是有什么在难住你，慢慢来。'],
  office: ['文档工作最耗神，别忘了眨眼。', '表格和文档慢慢处理，我陪着你。'],
  writing: ['写下来的东西都会变成你的积累。', '这一页写得很认真呀。'],
  design: ['比例和留白看起来在反复琢磨呢。', '设计到纠结处，可以退后一步看看全局。'],
  meeting: ['开会中，我安静待着。', '记得会议结束起来走两步。'],
  reading: ['阅读使人沉静，慢慢看。', '看到重要的地方可以记一笔。'],
  video: ['休息时间到，放松一下吧。', '看视频摸个鱼，劳逸结合。'],
  chat: ['在和朋友聊天呀，我不打扰。', '聊天正忙，我先安静一会儿。'],
  browsing: ['网页开了不少，注意别走丢啦。', '查资料记得及时收拢线索。'],
  gaming: ['玩得开心！我就在旁边看着。', '放松局，尽情享受。'],
  terminal: ['命令跑起来了，等结果吧。', '调试顺利，马上就通。'],
  idle: ['这会儿在休息，正好。', '桌面安静下来了，我也打个盹。'],
  other: ['我还在看着，你继续忙你的。', '不管在做什么，我都在旁边。']
};

function classifyWindow(title = '', proc = '', texts = []) {
  const textHint = Array.isArray(texts) ? texts.slice(0, 20).join(' ') : '';
  const hay = `${proc} ${title} ${textHint}`.toLowerCase();
  for (const [category, keywords] of RULES) {
    if (keywords.some((k) => hay.includes(k))) return category;
  }
  if (!String(title).trim() && !textHint.trim()) return 'idle';
  return 'other';
}

/** 清洗模型返回的实体字段（长度/数量/类型兜底）。 */
function sanitizeEntities(raw) {
  const list = (v, count, len) =>
    (Array.isArray(v) ? v : [])
      .map((x) => String(x || '').trim().slice(0, len))
      .filter(Boolean)
      .slice(0, count);
  return {
    project: String(raw?.project || '').trim().slice(0, 40),
    files: [...new Set(list(raw?.files, 3, 50))],
    keywords: [...new Set(list(raw?.keywords, 6, 20))]
  };
}

/** 清洗主题词（跨天聚合时的粗粒度类别，如有论文/毕设/找实习这类"在忙什么主题"）。 */
function sanitizeTopics(raw) {
  return [...new Set(
    (Array.isArray(raw) ? raw : [])
      .map((x) => String(x || '').trim().slice(0, 16))
      .filter(Boolean)
  )].slice(0, 3);
}

function basicAnalyze({ title = '', process = '', texts = [] } = {}) {
  const category = classifyWindow(title, process, texts);
  const app = process || (title.split(' - ').pop() || '').trim();
  const notePool = NOTES[category] || NOTES.other;
  const head = String(title).split(' - ')[0].trim();
  const files = /\.[A-Za-z0-9]{1,8}$/.test(head) ? [head.slice(0, 50)] : [];
  const textHint = (texts || []).filter((t) => t && t.length >= 2 && t.length <= 30).slice(0, 3);
  const detailParts = [`前台应用：${app || '未知'}`];
  if (head) detailParts.push(`窗口：${head.slice(0, 40)}`);
  if (textHint.length) detailParts.push(`界面文本：${textHint.join(' / ')}`);
  return {
    activity: app ? `${ACTIVITY_TEXT[category]}（${app}）` : ACTIVITY_TEXT[category],
    category,
    app: app || '',
    isWorking: WORKING.has(category),
    signal: 'none',
    // 离线基础感知不做"要不要说出口"的模型判断，交给本地的节流规则（notes.shouldSpeakNote）
    speak: false,
    detail: detailParts.join('；').slice(0, 120),
    entities: {
      project: '',
      files,
      keywords: [...new Set([ACTIVITY_TEXT[category], app].filter(Boolean).map((s) => String(s).slice(0, 20)))].slice(0, 5)
    },
    topics: [ACTIVITY_TEXT[category]].filter(Boolean),
    note: notePool[Math.floor(Math.random() * notePool.length)],
    suggest: '',
    source: 'basic'
  };
}

const ANALYZE_SYSTEM = `你是桌面陪伴应用的屏幕理解模块。根据屏幕截图与当前前台窗口信息，判断用户此刻在做什么，输出严格 JSON（不要输出任何多余文字）：
{"activity":"一句话描述用户正在做什么（中文，不超过20字）","category":"coding|office|writing|design|meeting|reading|video|chat|browsing|gaming|terminal|idle|other","app":"最相关的应用名","isWorking":true或false,"signal":"none|error|success","speak":true或false,"detail":"更具体的描述（不超过60字）：在做什么、屏幕上的关键信息（文件名/页面/报错原文的关键部分）","entities":{"project":"项目或文档名（可空）","files":["具体文件名或页面标题（最多3个）"],"keywords":["关键词（最多5个）"]},"topics":["主题词（最多3个，如：论文/毕设/调试/找实习）"],"note":"给同伴的一句温柔观察（不超过30字，可为空字符串）","suggest":"可选的小提醒（不超过30字，可为空字符串）"}
判断规则：写代码、写文档、做设计、开会、读资料、终端命令等生产/学习行为 isWorking=true；看视频、游戏、聊天、浏览、发呆、桌面空闲 isWorking=false。
signal 判定：屏幕上出现明确的报错/失败/异常（红色错误提示、异常堆栈、测试失败、构建失败）→ "error"；出现明确的完成/成功（构建通过、测试全绿、任务完成提示）→ "success"；其余一律 "none"。
detail 与 entities 请从截图和下方「窗口文本摘录」中提取真实出现过的名字（文件名、项目名、报错关键行），不要编造；提取不到就留空数组/空字符串。
「窗口文本摘录」是操作系统无障碍树里的精确文本（不是 OCR），凡与屏幕上看到的一致就以它为准；topics 用来概括"这段时间在忙什么主题"，便于以后跨天回忆。
隐私红线：绝不复述屏幕上的密码、密钥、金额、身份证号或聊天内容原文。
note 字段请用「鲸鱼娘」的口吻（傲娇但甜、略微慵懒），不超过 30 字，写**具体的观察**（在做什么、卡在哪、节奏如何）。
note 请每次换一个说法，别老是同一个梗（例如每条都在提尾巴）；也不要与下方「最近已用过的观察」重复或换汤不换药。
speak 的判定：只有这条观察真的值得此刻在桌面上说出来（有趣的发现、值得提醒的事、能陪到他）才 true；
日常重复的操作、无话可说时一律 false——沉默也是一种陪伴。`;

function parseJsonLoose(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeCloudResult(parsed, { title = '', process = '' } = {}) {
  const category = CATEGORIES.has(parsed?.category) ? parsed.category : classifyWindow(title, process);
  const isWorking = typeof parsed?.isWorking === 'boolean' ? parsed.isWorking : WORKING.has(category);
  const app = String(parsed?.app || process || '').trim();
  return {
    activity: String(parsed?.activity || ACTIVITY_TEXT[category] || '').slice(0, 60),
    category,
    app,
    isWorking,
    signal: ['error', 'success'].includes(parsed?.signal) ? parsed.signal : 'none',
    speak: parsed?.speak === true,
    detail: String(parsed?.detail || '').slice(0, 120),
    entities: sanitizeEntities(parsed?.entities),
    topics: sanitizeTopics(parsed?.topics),
    note: String(parsed?.note || '').slice(0, 80),
    suggest: String(parsed?.suggest || '').slice(0, 80),
    source: 'cloud'
  };
}

/** 调用云端视觉模型（OpenAI 兼容）。失败时抛出错误，由 analyze() 统一降级。 */
async function cloudAnalyze({ jpegBase64, title = '', process = '', texts = [], recentNotes = [], cfg, timeoutMs = 45000 }) {
  const base = String(cfg.model.baseUrl || '').replace(/\/+$/, '');
  const textExcerpt = Array.isArray(texts) && texts.length
    ? `窗口文本摘录（来自无障碍树的精确文本，可作为 detail/entities 的依据）：${texts.slice(0, 30).join(' | ').slice(0, 700)}`
    : '窗口文本摘录：无（未能读取无障碍树，请完全依据截图判断）';
  const recentLine = Array.isArray(recentNotes) && recentNotes.length
    ? `最近已用过的观察（务必换意象/句式，不要重复）：${recentNotes.slice(-5).map((t) => String(t).slice(0, 40)).join(' | ')}`
    : '最近已用过的观察：无';
  const body = {
    model: cfg.model.model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: ANALYZE_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: `当前前台窗口：${title || '未知'}（进程：${process || '未知'}）。\n${textExcerpt}\n${recentLine}\n请理解这张屏幕截图并输出 JSON。` },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } }
        ]
      }
    ]
  };
  // 预设附加参数（如百炼 Qwen-Omni 需要 modalities:["text"]）
  if (cfg.model.extraBody && typeof cfg.model.extraBody === 'object') {
    Object.assign(body, cfg.model.extraBody);
  }
  const resp = await guardedFetch(
    `${base}/chat/completions`,
    {
      cfg,
      timeoutMs,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.model.apiKey}` },
      body: JSON.stringify(body)
    }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 160)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  const parsed = parseJsonLoose(content);
  if (!parsed) throw new Error('云端返回无法解析为 JSON');
  return normalizeCloudResult(parsed, { title, process });
}

/** 统一入口：有 Key 走云端视觉模型；无 Key / 失败 → 基础感知（source 标注 cloud/basic）。 */
async function analyze({ jpeg, title = '', process = '', texts = [], recentNotes = [], cfg }) {
  const cloudReady = !!(cfg?.model?.apiKey && cfg?.model?.model && cfg?.model?.baseUrl);
  if (cloudReady) {
    try {
      return await cloudAnalyze({ jpegBase64: jpeg.toString('base64'), title, process, texts, recentNotes, cfg });
    } catch (err) {
      const fallback = basicAnalyze({ title, process, texts });
      fallback.cloudError = String(err?.message || err).slice(0, 200);
      return fallback;
    }
  }
  return basicAnalyze({ title, process, texts });
}

module.exports = {
  WORKING,
  CATEGORIES,
  ACTIVITY_TEXT,
  classifyWindow,
  basicAnalyze,
  parseJsonLoose,
  normalizeCloudResult,
  cloudAnalyze,
  analyze,
  sanitizeTopics,
  ANALYZE_SYSTEM
};

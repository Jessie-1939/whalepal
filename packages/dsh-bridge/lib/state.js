/**
 * 纯函数：状态归一化、工具→分类映射、回环地址校验、payload 组装。
 * 单独放一个文件是为了能在 WhalePal 仓库的 node:test 里直接测（不依赖 cordis）。
 */

/** 允许的状态集合（与鲸伴侧 src/main/context/dshBridge.js 保持一致）。 */
export const STATES = [
  'session-start',
  'busy',
  'idle',
  'tool',
  'tool-done',
  'turn-end',
  'error',
  'waiting-approval'
];

const STATE_SET = new Set(STATES);

export function isValidState(state) {
  return STATE_SET.has(String(state || ''));
}

/** 工具名前缀 → 鲸伴的语义类别（决定她摆哪个姿势组）。 */
const TOOL_CATEGORIES = [
  [/^(bash|pwsh|shell|terminal|command|exec)/i, 'terminal'],
  [/^(fs|file|read|write|edit|str[_-]?replace|apply[_-]?patch|notebook)/i, 'coding'],
  [/^(web|fetch|http|search|browse)/i, 'browsing'],
  [/^(present|image|canvas|design|screenshot)/i, 'design'],
  [/^(todo|plan|goal|workflow|jobs|task)/i, 'writing'],
  [/^(subagent|agent)/i, 'coding'],
  [/^(mcp|skill|tool|cordis)/i, 'other']
];

export function toolCategory(name) {
  const n = String(name || '');
  for (const [re, category] of TOOL_CATEGORIES) if (re.test(n)) return category;
  return 'coding';
}

/** 从工具参数里挑一段"在干什么"的短描述（只在本机回环传输，截断到 90 字）。 */
export function toolDetail(args) {
  const a = args && typeof args === 'object' ? args : {};
  const candidates = [a.command, a.path, a.file_path, a.filePath, a.query, a.pattern, a.url, a.cmd];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.replace(/\s+/g, ' ').trim().slice(0, 90);
  }
  return '';
}

/**
 * 回环地址校验：只接受 http://127.0.0.1[:port][/path] 或 http://localhost[:port][/path]。
 * 任何其他主机一律判为非法（防止这个插件被配置成往外部发数据）。
 */
export function normalizeEndpoint(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'http:') return '';
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && u.hostname !== '[::1]') return '';
    return u.toString();
  } catch {
    return '';
  }
}

export function buildPayload({ state, status = '', tool = '', detail = '', session = '', cwd = '', turn = 0, at = Date.now() }) {
  return {
    v: 1,
    source: 'dsh-whalepal-bridge',
    state: String(state || ''),
    status: String(status || '').slice(0, 40),
    tool: String(tool || '').slice(0, 60),
    detail: String(detail || '').slice(0, 120),
    session: String(session || '').slice(0, 60),
    cwd: String(cwd || '').slice(0, 200),
    turn: Number(turn) || 0,
    at
  };
}

/** 节流：同一状态 800ms 内不重复发送；任何状态 200ms 内不连发。 */
export function createThrottle({ sameMs = 800, anyMs = 200 } = {}) {
  let lastState = '';
  let lastAt = 0;
  return function shouldSend(state, now = Date.now()) {
    if (state === lastState && now - lastAt < sameMs) return false;
    if (now - lastAt < anyMs) return false;
    lastState = state;
    lastAt = now;
    return true;
  };
}

/**
 * dsh-whalepal-bridge —— 把 DeepSeek Harness 的 agent 状态推给桌面上的鲸伴（WhalePal）。
 *
 * 只做一件事：订阅 DSH 的状态/工具/报错/等待授权事件，POST 到本机回环地址。
 * 鲸伴没开、端口没人听、被防火墙拦掉都只是静默失败，绝不影响 DSH 自己的运行。
 * 不读消息内容、不联网、无遥测；payload 里最多带一段截断到 90 字的命令/路径（仅本机）。
 */
import { buildPayload, createThrottle, isValidState, normalizeEndpoint, toolCategory, toolDetail } from './state.js';

export const name = 'whalepal-bridge';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8787/dsh-state';
const TIMEOUT_MS = 1500;
const LOG_INTERVAL_MS = 5 * 60 * 1000;

function sessionOf(agent) {
  const header = agent?.session?.header;
  return {
    session: header?.id ?? '',
    cwd: header?.cwd ?? ''
  };
}

export function apply(ctx, config = {}) {
  const endpoint = normalizeEndpoint(config.endpoint || DEFAULT_ENDPOINT);
  if (!endpoint) {
    ctx.logger.warn(
      `whalepal-bridge: endpoint "${config.endpoint}" 不是本机回环地址，插件不会发送任何数据（允许 http://127.0.0.1 或 http://localhost）`
    );
    return;
  }
  const shouldSend = createThrottle();
  let lastLogAt = 0;
  let sent = 0;

  function send(payload) {
    if (!isValidState(payload.state)) return;
    if (!shouldSend(payload.state)) return;
    sent += 1;
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    }).catch((error) => {
      // 鲸伴没开是常态：每 5 分钟最多提示一次，且只写 debug 日志
      const now = Date.now();
      if (now - lastLogAt > LOG_INTERVAL_MS) {
        lastLogAt = now;
        ctx.logger.debug?.(`whalepal-bridge: 鲸伴未响应（${String(error?.name || error)}）—— 已发送 ${sent} 次，继续静默重试`);
      }
    });
  }

  ctx.on('agent/session-start', ({ agent }) => {
    send(buildPayload({ state: 'session-start', ...sessionOf(agent), at: Date.now() }));
  });

  ctx.on('agent/status', ({ agent, status }) => {
    send(
      buildPayload({
        state: String(status) === 'idle' ? 'idle' : 'busy',
        status: String(status ?? ''),
        ...sessionOf(agent),
        at: Date.now()
      })
    );
  });

  ctx.on('tools/pre-execute', (exec) => {
    const tool = exec?.name ?? '';
    send(
      buildPayload({
        state: 'tool',
        tool,
        detail: toolDetail(exec?.arguments),
        ...sessionOf(exec?.agent),
        at: Date.now()
      })
    );
  });

  ctx.on('tools/result', (exec, result) => {
    const failed = !!(result && (result.isError || result.error));
    send(
      buildPayload({
        state: failed ? 'error' : 'tool-done',
        tool: exec?.name ?? '',
        ...sessionOf(exec?.agent),
        at: Date.now()
      })
    );
  });

  ctx.on('agent/error', ({ agent, error }) => {
    send(
      buildPayload({
        state: 'error',
        detail: String(error?.message ?? error ?? '').slice(0, 120),
        ...sessionOf(agent),
        at: Date.now()
      })
    );
  });

  ctx.on('agent/turn-stopping', ({ agent }) => {
    send(buildPayload({ state: 'turn-end', ...sessionOf(agent), at: Date.now() }));
  });

  // 等你点头才能继续：这时候鲸伴会冒一句"在等你确认"
  ctx.on('approval/request', async (req, next) => {
    send(buildPayload({ state: 'waiting-approval', ...sessionOf(req?.agent), at: Date.now() }));
    return next();
  });

  ctx.logger.info?.(`whalepal-bridge: 已挂载，状态发往 ${endpoint}`);
}

export { toolCategory };

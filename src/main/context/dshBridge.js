/**
 * DSH 桥接（接收端）。
 *
 * DeepSeek Harness 装上 `dsh-whalepal-bridge` 插件后，会把 agent 的真实状态
 * （思考 / 跑工具 / 报错 / 回合结束 / 等待授权）POST 到本机回环地址；
 * 这里只监听 127.0.0.1 的一个端口，收到后交给主进程广播给桌宠——
 * 于是她不必靠截屏猜，而是直接知道 agent 在干什么。
 *
 * 设计约束（对齐项目的隐私承诺）：
 *   - 只绑定 127.0.0.1，绝不监听 0.0.0.0 / 局域网；
 *   - 只接受 POST 的 JSON，请求体上限 8KB，字段全部重新校验并截断；
 *   - 不主动外连、不落盘、不转发给云端；DSH 没开或插件没装时，这个端口安静地闲置。
 */
const http = require('node:http');

const STATES = new Set([
  'session-start',
  'busy',
  'idle',
  'tool',
  'tool-done',
  'turn-end',
  'error',
  'waiting-approval'
]);

const MAX_BODY = 8 * 1024;

/** 校验并归一化一条来自插件的状态（纯函数，可单测）。非法返回 null。 */
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const state = String(raw.state || '');
  if (!STATES.has(state)) return null;
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  return {
    v: 1,
    state,
    status: str(raw.status, 40),
    tool: str(raw.tool, 60),
    detail: str(raw.detail, 120),
    session: str(raw.session, 60),
    cwd: str(raw.cwd, 200),
    turn: Number(raw.turn) || 0,
    at: Number(raw.at) || Date.now(),
    receivedAt: Date.now()
  };
}

class DshBridge {
  constructor({ config, onState, logger = console }) {
    this.config = config;
    this.onState = onState;
    this.logger = logger;
    this.server = null;
    this.port = 0;
    this.lastState = null;
    this.lastError = '';
  }

  _cfg() {
    const c = this.config.get();
    const dsh = (c && c.dsh) || {};
    // 0 = 让系统分配随机端口（仅测试用）；未配置/非法 → 8787；其余夹在 1024-65535（设置页同范围）
    const raw = Number(dsh.port);
    const port = raw === 0 ? 0 : Number.isFinite(raw) && raw > 0 ? Math.min(65535, Math.max(1024, raw)) : 8787;
    return { enabled: dsh.enabled !== false, port };
  }

  start() {
    this.stop();
    const { enabled, port } = this._cfg();
    if (!enabled) {
      this.lastError = '';
      return;
    }
    this.port = port;
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain' }).end('method not allowed');
        return;
      }
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          res.writeHead(413, { 'content-type': 'text/plain' }).end('too large');
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (size > MAX_BODY) return;
        let parsed = null;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.writeHead(400, { 'content-type': 'text/plain' }).end('bad json');
          return;
        }
        const state = normalizeState(parsed);
        if (!state) {
          res.writeHead(400, { 'content-type': 'text/plain' }).end('bad payload');
          return;
        }
        res.writeHead(204).end();
        this.lastState = state;
        try {
          this.onState(state);
        } catch (err) {
          this.logger.warn?.('[dsh] onState failed:', err?.message || err);
        }
      });
    });
    this.server.on('error', (err) => {
      this.lastError = String(err?.message || err).slice(0, 160);
      this.logger.warn?.('[dsh] bridge listen failed:', this.lastError);
    });
    this.server.listen(port, '127.0.0.1');
  }

  stop() {
    if (!this.server) return;
    try {
      this.server.close();
    } catch {
      // 忽略
    }
    this.server = null;
  }

  restart() {
    this.start();
  }

  status() {
    const { enabled, port } = this._cfg();
    return {
      enabled,
      port,
      listening: !!this.server && this.server.listening,
      lastError: this.lastError,
      lastState: this.lastState
    };
  }
}

module.exports = { DshBridge, normalizeState, STATES, MAX_BODY };

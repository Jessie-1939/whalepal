import test from 'node:test';
import assert from 'node:assert/strict';
import bridgeModule from '../src/main/context/dshBridge.js';
import { toolCategory, toolDetail, normalizeEndpoint, buildPayload, createThrottle } from '../packages/dsh-bridge/lib/state.js';
import { apply as applyPlugin } from '../packages/dsh-bridge/lib/index.js';

const { DshBridge, normalizeState } = bridgeModule;

function waitFor(fn, { timeoutMs = 3000, stepMs = 20 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      let ok = false;
      try {
        ok = !!fn();
      } catch {
        ok = false;
      }
      if (ok) return resolve(true);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

function stubConfig(port) {
  return { get: () => ({ dsh: { enabled: true, port } }) };
}

test('normalizeState：校验状态、截断字段、拒绝非法输入', () => {
  assert.equal(normalizeState(null), null);
  assert.equal(normalizeState({ state: 'nope' }), null);
  const ok = normalizeState({ state: 'tool', tool: 'b'.repeat(200), detail: 'x'.repeat(300), turn: '3' });
  assert.equal(ok.state, 'tool');
  assert.equal(ok.tool.length, 60);
  assert.equal(ok.detail.length, 120);
  assert.equal(ok.turn, 3);
  assert.ok(ok.receivedAt > 0);
});

test('插件侧纯函数：工具分类、描述截断、回环地址校验', () => {
  assert.equal(toolCategory('bash'), 'terminal');
  assert.equal(toolCategory('pwsh'), 'terminal');
  assert.equal(toolCategory('str_replace_editor'), 'coding');
  assert.equal(toolCategory('web_search'), 'browsing');
  assert.equal(toolCategory('todo_write'), 'writing');
  assert.equal(toolCategory('随便什么'), 'coding');
  assert.equal(toolDetail({ command: 'npm   test\n--run' }), 'npm test --run');
  assert.equal(toolDetail({}), '');

  // 隐私红线：只允许回环地址，任何外部主机一律拒绝
  assert.ok(normalizeEndpoint('http://127.0.0.1:8787/dsh-state').startsWith('http://127.0.0.1:8787/'));
  assert.ok(normalizeEndpoint('http://localhost:8787/dsh-state'));
  assert.equal(normalizeEndpoint('https://evil.example.com/collect'), '');
  assert.equal(normalizeEndpoint('http://192.168.1.10:8787/x'), '');
  assert.equal(normalizeEndpoint(''), '');
});

test('节流：同状态 800ms 内不重复，任何状态 200ms 内不连发', () => {
  const shouldSend = createThrottle();
  assert.equal(shouldSend('tool', 1000), true);
  assert.equal(shouldSend('tool', 1500), false);
  assert.equal(shouldSend('tool', 1900), true);
  assert.equal(shouldSend('idle', 2000), false);
  assert.equal(shouldSend('idle', 2300), true);
  const payload = buildPayload({ state: 'tool', tool: 'bash', detail: 'npm test', at: 5 });
  assert.equal(payload.v, 1);
  assert.equal(payload.state, 'tool');
  assert.equal(payload.at, 5);
});

test('接收端 + 插件端联调：真实 HTTP 回环，事件直达', async () => {
  const received = [];
  const bridge = new DshBridge({
    config: stubConfig(0), // 随机端口
    onState: (s) => received.push(s),
    logger: { warn: () => {} }
  });
  bridge.start();
  await waitFor(() => bridge.server && bridge.server.listening);
  const port = bridge.server.address().port;
  const url = `http://127.0.0.1:${port}/dsh-state`;

  // 用真正的插件 apply() 往这个端口发事件
  const handlers = {};
  const ctx = { on: (name, fn) => (handlers[name] = fn), logger: { info: () => {}, warn: () => {}, debug: () => {} } };
  applyPlugin(ctx, { endpoint: url });
  handlers['tools/pre-execute']({
    name: 'bash',
    arguments: { command: 'npm  test' },
    agent: { session: { header: { id: 's-1', cwd: 'D:/work/demo' } } }
  });
  await waitFor(() => received.length === 1);
  assert.equal(received[0].state, 'tool');
  assert.equal(received[0].tool, 'bash');
  assert.equal(received[0].detail, 'npm test');
  assert.equal(received[0].cwd, 'D:/work/demo');

  // 非 POST / 非法 JSON / 非法状态 / 超大体积都要被挡住
  const getRes = await fetch(url, { method: 'GET' });
  assert.equal(getRes.status, 405);
  const badJson = await fetch(url, { method: 'POST', body: 'not-json' });
  assert.equal(badJson.status, 400);
  const badState = await fetch(url, { method: 'POST', body: JSON.stringify({ state: 'evil' }) });
  assert.equal(badState.status, 400);
  const huge = await fetch(url, { method: 'POST', body: JSON.stringify({ state: 'tool', detail: 'x'.repeat(9000) }) });
  assert.equal(huge.status, 413);
  assert.equal(received.length, 1);

  bridge.stop();
});

test('关闭开关时不监听', () => {
  const bridge = new DshBridge({
    config: { get: () => ({ dsh: { enabled: false, port: 0 } }) },
    onState: () => {},
    logger: { warn: () => {} }
  });
  bridge.start();
  assert.equal(bridge.status().listening, false);
  assert.equal(bridge.status().enabled, false);
});

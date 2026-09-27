import test from 'node:test';
import assert from 'node:assert/strict';
import net from '../src/main/context/net.js';

const CFG = {
  model: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  }
};

test('isAllowedUrl：只允许配置端点的 https 路径 + 本机 http', () => {
  const base = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  assert.equal(net.isAllowedUrl(`${base}/chat/completions`, CFG), true);
  assert.equal(net.isAllowedUrl('https://evil.example.com/v1/chat/completions', CFG), false);
  assert.equal(
    net.isAllowedUrl('http://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', CFG),
    false
  );
  assert.equal(net.isAllowedUrl('http://localhost:1234/v1/chat/completions', CFG), true);
  assert.equal(net.isAllowedUrl('https://dashscope.aliyuncs.com/other', CFG), false);
  assert.equal(net.isAllowedUrl(`${base}/chat/completions`, {}), false);
});

test('guardedFetch：非白名单地址直接拒绝（不发起请求）', async () => {
  await assert.rejects(
    () => net.guardedFetch('https://evil.example.com/v1/chat/completions', { cfg: CFG, timeoutMs: 1000 }),
    /egress blocked/
  );
});

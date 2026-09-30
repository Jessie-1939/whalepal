import test from 'node:test';
import assert from 'node:assert/strict';
import chat from '../src/main/context/chat.js';
import { MODEL_PRESETS } from '../src/main/config.js';

test('供应商预设包含阿里云百炼（Qwen）', () => {
  const b = MODEL_PRESETS.bailian;
  assert.ok(b, 'bailian preset missing');
  assert.ok(b.baseUrl.includes('aliyuncs.com'));
  assert.equal(b.model, 'qwen3.8-omni-flash');
  assert.deepEqual(b.extraBody, { modalities: ['text'], enable_thinking: false });
});

test('供应商预设包含 DeepSeek（deepseek-flash，视觉输入）', () => {
  const d = MODEL_PRESETS.deepseek;
  assert.ok(d, 'deepseek preset missing');
  assert.equal(d.baseUrl, 'https://api.deepseek.com');
  assert.equal(d.model, 'deepseek-flash');
  // 预设关闭思考模式（省输出 token），且不得带百炼的 enable_thinking/modalities 参数
  assert.deepEqual(d.extraBody, { thinking: { type: 'disabled' } });
  assert.equal(d.extraBody.enable_thinking, undefined);
  assert.equal(d.extraBody.modalities, undefined);
});

test('mergeExtraBody：预设附加参数合并进请求体且不污染原对象', () => {
  const payload = { model: 'm', messages: [] };
  const merged = chat.mergeExtraBody(payload, { model: { extraBody: { modalities: ['text'] } } });
  assert.deepEqual(merged.modalities, ['text']);
  assert.equal(merged.model, 'm');
  assert.equal(payload.modalities, undefined);
  const untouched = chat.mergeExtraBody(payload, { model: {} });
  assert.equal(untouched.modalities, undefined);
});

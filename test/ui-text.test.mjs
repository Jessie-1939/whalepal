import test from 'node:test';
import assert from 'node:assert/strict';
import { UI_TEXT_PS1, filterUiTexts, createUiTextPolicy } from '../src/main/context/uiText.js';

test('filterUiTexts：去空白 / 去重 / 限长 / 剔除疑似密钥', () => {
  const fakeKey = 'sk' + '-' + 'a'.repeat(24);
  const out = filterUiTexts([
    '  app.py  ',
    'app.py',
    'x',
    fakeKey,
    'A'.repeat(90),
    '找不到 E:\\work\\20260921.txt 文件。'
  ]);
  assert.deepEqual(out, ['app.py', '找不到 E:\\work\\20260921.txt 文件。']);
});

test('filterUiTexts：条数上限', () => {
  const many = Array.from({ length: 50 }, (_, i) => `item-${i}`);
  assert.equal(filterUiTexts(many).length, 30);
});

test('createUiTextPolicy：首次给长超时，失败进负缓存，超时过重试仍给长超时', () => {
  const p = createUiTextPolicy({ negativeMs: 1000, firstMs: 5000, fastMs: 1400 });
  assert.equal(p.skip('code'), false);
  assert.equal(p.timeoutFor('code'), 5000);
  p.record('code', { ok: false, timedOut: true, now: 0 });
  assert.equal(p.skip('code', 500), true);
  assert.equal(p.skip('code', 1001), false);
  assert.equal(p.timeoutFor('code'), 5000);
  p.record('code', { ok: true, now: 2000 });
  assert.equal(p.timeoutFor('code'), 1400);
  assert.equal(p.skip('code', 3000), false);
});

test('createUiTextPolicy：空进程名直接跳过', () => {
  const p = createUiTextPolicy();
  assert.equal(p.skip(''), true);
});

test('UIA 脚本只读前台窗口，且带输出编码设置', () => {
  assert.ok(UI_TEXT_PS1.includes('UIAutomationClient'));
  assert.ok(UI_TEXT_PS1.includes('GetForegroundWindow'));
  assert.ok(UI_TEXT_PS1.includes('OutputEncoding'));
});

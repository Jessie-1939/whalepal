import test from 'node:test';
import assert from 'node:assert/strict';
import chat from '../src/main/context/chat.js';

test('bubbleChunks：短回答原样一段', () => {
  assert.deepEqual(chat.bubbleChunks('我在的，一直在。'), ['我在的，一直在。']);
});

test('bubbleChunks：空内容不产生气泡', () => {
  assert.deepEqual(chat.bubbleChunks(''), []);
  assert.deepEqual(chat.bubbleChunks('   '), []);
  assert.deepEqual(chat.bubbleChunks(null), []);
});

test('bubbleChunks：长回答按句末标点切段，每段不超上限', () => {
  const long =
    '今天你从早上开始一直在调试鲸伴的对话链路，中间看了会儿视频放松，' +
    '下午又回到 Obsidian 写论文的选题分析，专注了大约三个小时。' +
    '记得起来活动一下，眼睛也需要休息，别一直盯着屏幕不动。';
  const chunks = chat.bubbleChunks(long);
  assert.ok(chunks.length >= 2 && chunks.length <= 3);
  for (const c of chunks) assert.ok(c.length <= 80, `分段超长：${c.length}`);
  const joined = chunks.join('');
  assert.ok(joined.includes('调试鲸伴'));
});

test('bubbleChunks：超长内容只保留三段并以省略号收尾', () => {
  const huge = '这是一句测试。'.repeat(40);
  const chunks = chat.bubbleChunks(huge);
  assert.equal(chunks.length, 3);
  assert.ok(chunks[2].endsWith('…'));
});

test('bubbleChunks：换行与多余空白被压平', () => {
  const chunks = chat.bubbleChunks('第一行\n\n第二行   第三行');
  assert.deepEqual(chunks, ['第一行 第二行 第三行']);
});

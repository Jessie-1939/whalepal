import test from 'node:test';
import assert from 'node:assert/strict';
import poseMap from '../src/renderer/core/pose-map.js';

const WORK_FILES = [
  'tool.webp',
  'work-boss.webp',
  'work-celebrate.webp',
  'work-deadline.webp',
  'work-debug.webp',
  'work-deploy.webp',
  'work-idea.webp',
  'work-meeting.webp',
  'work-pat.webp',
  'work-ram.webp',
  'work-review.webp',
  'work-slack-phone.webp',
  'work-slack.webp'
];

test('工作姿势：语义组内按 rotateIndex 轮换（不再是单张，也不是随机）', () => {
  const coding = { category: 'coding' };
  assert.equal(poseMap.chooseFile('work', coding, WORK_FILES, () => 0.9, 0), 'work-debug.webp');
  assert.equal(poseMap.chooseFile('work', coding, WORK_FILES, () => 0.9, 1), 'work-ram.webp');
  assert.equal(poseMap.chooseFile('work', coding, WORK_FILES, () => 0.9, 2), 'tool.webp');
  assert.equal(poseMap.chooseFile('work', coding, WORK_FILES, () => 0.9, 3), 'work-debug.webp'); // 回环
  // 同一输入 + 同一序号 → 永远同一张（确定性）
  assert.equal(
    poseMap.chooseFile('work', coding, WORK_FILES, () => 0.1, 1),
    poseMap.chooseFile('work', coding, WORK_FILES, () => 0.7, 1)
  );
});

test('工作姿势：不同内容落在不同语义组', () => {
  assert.equal(poseMap.chooseFile('work', { category: 'meeting' }, WORK_FILES, Math.random, 0), 'work-meeting.webp');
  assert.equal(
    poseMap.chooseFile('work', { category: 'meeting' }, WORK_FILES, Math.random, 1),
    'work-slack-phone.webp'
  );
  assert.equal(poseMap.chooseFile('work', { category: 'office' }, WORK_FILES, Math.random, 0), 'work-review.webp');
  assert.equal(poseMap.chooseFile('work', { category: 'office' }, WORK_FILES, Math.random, 1), 'work-slack.webp');
  assert.equal(
    poseMap.chooseFile('work', { category: 'coding', activity: '部署上线' }, WORK_FILES, Math.random, 0),
    'work-deploy.webp'
  );
  assert.equal(
    poseMap.chooseFile('work', { category: 'coding', activity: '部署上线' }, WORK_FILES, Math.random, 1),
    'work-celebrate.webp'
  );
  // 未知类别 → 稳定兜底组（review → boss → pat）
  assert.equal(poseMap.chooseFile('work', { category: 'other' }, WORK_FILES, Math.random, 0), 'work-review.webp');
  assert.equal(poseMap.chooseFile('work', { category: 'other' }, WORK_FILES, Math.random, 1), 'work-boss.webp');
});

test('待机基础图：小分组慢轮换；小动作有内容偏好', () => {
  const idleFiles = ['idle-cute.webp', 'greet.webp', 'curious.webp', 'daily-coffee.webp', 'daily-gaming.webp'];
  assert.equal(poseMap.chooseFile('idle', {}, idleFiles, Math.random, 0), 'idle-cute.webp');
  assert.equal(poseMap.chooseFile('idle', {}, idleFiles, Math.random, 1), 'greet.webp');
  assert.equal(poseMap.chooseFile('idle', {}, idleFiles, Math.random, 2), 'curious.webp');
  assert.equal(poseMap.chooseFile('idle', {}, idleFiles, Math.random, 3), 'idle-cute.webp');
  assert.equal(poseMap.preferredIdleAction('video'), 'daily-fishing');
  assert.equal(poseMap.preferredIdleAction('gaming'), 'daily-gaming');
});

test('互动姿势保留随机（注入固定随机源可复现）', () => {
  const files = ['shy.webp', 'happy.webp'];
  assert.equal(poseMap.chooseFile('shy', {}, files, () => 0), 'shy.webp');
  assert.equal(poseMap.chooseFile('shy', {}, files, () => 0.99), 'happy.webp');
});

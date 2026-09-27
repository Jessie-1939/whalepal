import test from 'node:test';
import assert from 'node:assert/strict';
import poseMap from '../src/renderer/core/pose-map.js';

const WORK_FILES = [
  'work-boss.webp',
  'work-deadline.webp',
  'work-debug.webp',
  'work-deploy.webp',
  'work-idea.webp',
  'work-meeting.webp',
  'work-review.webp',
  'tool.webp'
];

test('工作姿势：按屏幕内容确定性映射，不随机', () => {
  assert.equal(poseMap.chooseFile('work', { category: 'coding' }, WORK_FILES, () => 0.9), 'work-debug.webp');
  assert.equal(poseMap.chooseFile('work', { category: 'meeting' }, WORK_FILES, () => 0.1), 'work-meeting.webp');
  assert.equal(poseMap.chooseFile('work', { category: 'office' }, WORK_FILES, () => 0.5), 'work-review.webp');
  assert.equal(
    poseMap.chooseFile('work', { category: 'coding', activity: '部署上线（kubectl）' }, WORK_FILES, () => 0.3),
    'work-deploy.webp'
  );
  assert.equal(
    poseMap.chooseFile('work', { category: 'coding', activity: '排查报错日志' }, WORK_FILES, () => 0.7),
    'work-debug.webp'
  );
  // 未知类别 → 稳定兜底（而不是随机）
  assert.equal(poseMap.chooseFile('work', { category: 'other' }, WORK_FILES, () => 0.99), 'work-review.webp');
  // 同一输入永远得到同一结果
  const a = poseMap.chooseFile('work', { category: 'coding' }, WORK_FILES, () => 0.2);
  const b = poseMap.chooseFile('work', { category: 'coding' }, WORK_FILES, () => 0.8);
  assert.equal(a, b);
});

test('待机：基础图固定 idle-cute；小动作有内容偏好', () => {
  const idleFiles = ['idle-cute.webp', 'daily-coffee.webp', 'daily-gaming.webp', 'daily-fishing.webp'];
  assert.equal(poseMap.chooseFile('idle', { category: 'coding' }, idleFiles, () => 0.9), 'idle-cute.webp');
  assert.equal(poseMap.preferredIdleAction('video'), 'daily-fishing');
  assert.equal(poseMap.preferredIdleAction('gaming'), 'daily-gaming');
  assert.equal(poseMap.preferredIdleAction('coding'), 'daily-stretch');
});

test('互动姿势保留随机（注入固定随机源可复现）', () => {
  const files = ['shy.webp', 'happy.webp'];
  assert.equal(poseMap.chooseFile('shy', {}, files, () => 0), 'shy.webp');
  assert.equal(poseMap.chooseFile('shy', {}, files, () => 0.99), 'happy.webp');
});

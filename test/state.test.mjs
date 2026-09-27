import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../src/renderer/core/state.js';
import linesLib from '../src/renderer/core/lines.js';

const lines = linesLib.Lines;
const QUIET = { start: 23, end: 6 };

function run(state, event) {
  return core.handle(state, event, { rng: () => 0, lines });
}

test('工作上下文进入 work 状态', () => {
  const { state, actions } = run(core.createWhale(null), { type: 'context', isWorking: true });
  assert.equal(state.phase, 'work');
  assert.equal(state.pose, 'work');
  assert.ok(actions.some((a) => a.type === 'pose' && a.pose === 'work'));
});

test('空闲上下文回到 idle', () => {
  let s = core.createWhale(null);
  s = run(s, { type: 'context', isWorking: true }).state;
  s = run(s, { type: 'context', isWorking: false, hour: 14, quiet: QUIET }).state;
  assert.equal(s.phase, 'idle');
});

test('深夜空闲进入 sleep，白天恢复 idle', () => {
  let s = core.createWhale(null);
  s = run(s, { type: 'tick', hour: 23, deltaMs: 0, quiet: QUIET }).state;
  assert.equal(s.phase, 'sleep');
  s = run(s, { type: 'tick', hour: 10, deltaMs: 0, quiet: QUIET }).state;
  assert.equal(s.phase, 'idle');
});

test('摸头：好感 +1、解锁成就、触发爱心特效', () => {
  const { state, actions } = run(core.createWhale(null), { type: 'click', zone: 'head' });
  assert.equal(state.patCount, 1);
  assert.equal(state.affinity, 1);
  assert.ok(state.achievements.first_pat);
  assert.ok(actions.some((a) => a.type === 'fx' && a.value === 'hearts'));
});

test('投喂：饱食 +10 且不超过 100', () => {
  let s = core.createWhale({ satiety: 95 });
  s = run(s, { type: 'feed' }).state;
  assert.equal(s.satiety, 100);
  assert.equal(s.feedCount, 1);
});

test('戳一下：心情下降但不低于 0', () => {
  let s = core.createWhale({ mood: 3 });
  s = run(s, { type: 'poke' }).state;
  assert.equal(s.mood, 0);
});

test('好感跨过阈值触发升级', () => {
  let s = core.createWhale({ affinity: 29 });
  const { state, actions } = run(s, { type: 'click', zone: 'head' });
  assert.equal(core.levelOf(state.affinity), 2);
  assert.ok(actions.some((a) => a.type === 'levelUp' && a.level === 2));
});

test('互动结束后回到主状态', () => {
  let s = core.createWhale(null);
  s = run(s, { type: 'context', isWorking: true }).state;
  s = run(s, { type: 'click', zone: 'head' }).state;
  assert.equal(s.phase, 'react');
  s = run(s, { type: 'react-done' }).state;
  assert.equal(s.phase, 'work');
});

test('陪伴满 60 分钟解锁成就', () => {
  let s = core.createWhale(null);
  s = run(s, { type: 'tick', hour: 12, deltaMs: 60 * 60 * 1000, quiet: QUIET }).state;
  assert.ok(s.achievements.companion_60);
});

test('深夜关怀计入成就', () => {
  let s = core.createWhale(null);
  s = run(s, { type: 'care', tag: 'night' }).state;
  assert.ok(s.achievements.care_night);
  assert.equal(s.careCount, 1);
});

test('台词库池非空且 pick 行为稳定', () => {
  assert.ok(lines.interaction.head.length > 0);
  assert.ok(lines.care.sitting.length > 0);
  assert.equal(linesLib.pick(['a'], () => 0.99), 'a');
  assert.equal(linesLib.pick([], () => 0.5), '');
});

test('AFK：待机时打盹，互动后唤醒回待机', () => {
  let s = core.createWhale(null);
  s = run(s, { type: 'nap' }).state;
  assert.equal(s.phase, 'sleep');
  assert.equal(s.pose, 'sleep');
  assert.equal(s.napAfk, true);
  s = run(s, { type: 'wake', hour: 12, quiet: QUIET }).state;
  assert.equal(s.phase, 'idle');
  assert.equal(s.napAfk, false);
});

test('非待机不打盹；夜间睡眠不会被 wake 改成 idle', () => {
  let w = core.createWhale(null);
  w = run(w, { type: 'context', isWorking: true }).state;
  w = run(w, { type: 'nap' }).state;
  assert.equal(w.phase, 'work');

  let n = core.createWhale(null);
  n = run(n, { type: 'tick', hour: 23, deltaMs: 0, quiet: QUIET }).state;
  assert.equal(n.phase, 'sleep');
  assert.equal(n.napAfk, false);
  n = run(n, { type: 'wake', hour: 23, quiet: QUIET }).state;
  assert.equal(n.phase, 'sleep');
});

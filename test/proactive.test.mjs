import test from 'node:test';
import assert from 'node:assert/strict';
import proactive from '../src/main/context/proactive.js';
import persona from '../src/main/context/persona.js';
import chat from '../src/main/context/chat.js';

function stubDialogue(entries = []) {
  return {
    recent: (n) => entries.slice(-n),
    lastOfRole: (role) => {
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i].role === role) return entries[i];
      return null;
    },
    lastOfKind: (kinds) => {
      const list = Array.isArray(kinds) ? kinds : [kinds];
      for (let i = entries.length - 1; i >= 0; i--) if (list.includes(entries[i].kind)) return entries[i];
      return null;
    }
  };
}

const NOW = 1750000000000;
const CFG = {
  companion: { proactive: true, bubbles: true, visible: true, quietHours: { start: 23, end: 6 } }
};
const ACTIVE_EVENT = { ts: NOW - 60 * 1000, isWorking: false };
const BASE = { cfg: CFG, now: NOW, hour: 15, lastEvent: ACTIVE_EVENT, hasKey: true };

test('安静时段不发送', () => {
  const r = proactive.evaluateProactiveGates({ ...BASE, hour: 23, dialogue: stubDialogue([]) });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'quiet');
});

test('工作中不发送', () => {
  const r = proactive.evaluateProactiveGates({
    ...BASE,
    lastEvent: { ts: NOW - 1000, isWorking: true },
    dialogue: stubDialogue([])
  });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'working');
});

test('无云端 Key 且无未回应时不发送', () => {
  const r = proactive.evaluateProactiveGates({ ...BASE, hasKey: false, dialogue: stubDialogue([]) });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'no-cloud-key');
});

test('冷却期内不发送', () => {
  const dialogue = stubDialogue([
    { ts: NOW - 6 * 60 * 1000, role: 'pet', kind: 'proactive', text: '刚才那句' },
    { ts: NOW - 5 * 60 * 1000, role: 'user', kind: 'chat', text: '嗯' }
  ]);
  const r = proactive.evaluateProactiveGates({ ...BASE, dialogue });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'cooldown');
});

test('未回应超时：发一次 TIMEOUT_SIGNAL', () => {
  const dialogue = stubDialogue([{ ts: NOW - 6 * 60 * 1000, role: 'pet', kind: 'proactive', text: '在忙什么呀？' }]);
  const r = proactive.evaluateProactiveGates({ ...BASE, dialogue });
  assert.equal(r.allow, true);
  assert.equal(r.mode, 'timeout');
});

test('已发过超时信号则保持安静，直到主人先互动', () => {
  const dialogue = stubDialogue([
    { ts: NOW - 6 * 60 * 1000, role: 'pet', kind: 'proactive', text: '在忙什么呀？' },
    { ts: NOW - 2 * 60 * 1000, role: 'pet', kind: 'timeout', text: proactive.TIMEOUT_LINE }
  ]);
  const r = proactive.evaluateProactiveGates({ ...BASE, dialogue });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'awaiting-user');
});

test('主人已回应且过了冷却：交给模型判断', () => {
  const dialogue = stubDialogue([
    { ts: NOW - 20 * 60 * 1000, role: 'pet', kind: 'proactive', text: '喝口水吧' },
    { ts: NOW - 19 * 60 * 1000, role: 'user', kind: 'chat', text: '好' }
  ]);
  const r = proactive.evaluateProactiveGates({ ...BASE, dialogue });
  assert.equal(r.allow, true);
  assert.equal(r.mode, 'model');
});

test('主人长时间无活动时不判断', () => {
  const r = proactive.evaluateProactiveGates({
    ...BASE,
    lastEvent: { ts: NOW - 40 * 60 * 1000, isWorking: false },
    dialogue: stubDialogue([])
  });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'no-activity');
});

test('人设块包含全部 token，主动工具只有 send_message / stay_silent', () => {
  for (const token of persona.PERSONA_TOKENS) assert.ok(persona.PERSONA_BLOCK.includes(token));
  assert.ok(persona.personaSystemPrompt({}).includes('鲸鱼娘'));
  const names = proactive.PROACTIVE_TOOLS.map((t) => t.function.name);
  assert.deepEqual(names, ['send_message', 'stay_silent']);
});

test('本地兜底：拒绝被说胖（TRAIT_NOT_FAT_REFUSE）', () => {
  const store = { today: () => [] };
  const answer = chat.recordsAnswer('你是不是胖了', store);
  assert.ok(answer.includes('不胖'));
});

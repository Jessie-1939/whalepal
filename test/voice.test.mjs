import test from 'node:test';
import assert from 'node:assert/strict';
import voice from '../src/main/context/voice.js';

const OFFLINE = {
  model: { apiKey: '', model: 'm', baseUrl: 'https://example.com/v1' },
  companion: { name: '主人', selfName: '小鲸' }
};
const ONLINE = {
  model: { apiKey: 'k', model: 'm', baseUrl: 'https://example.com/v1' },
  companion: { name: '主人', selfName: '小鲸' }
};

test('未配置 Key：直接用内置台词库（断网兜底）', async () => {
  const r = await voice.composeLine({
    kind: 'pat-head',
    cfg: OFFLINE,
    store: { readRecent: () => [] },
    dialogue: null
  });
  assert.equal(r.source, 'local');
  assert.ok(r.text.length > 0);
});

test('内置台词库覆盖每一类触发', () => {
  const kinds = [
    'pat-head', 'pat-belly', 'pat-tail', 'triple', 'feed', 'praise', 'poke',
    'care-sitting', 'care-night', 'care-welcome', 'signal-error', 'signal-success',
    'greeting', 'spawn'
  ];
  for (const kind of kinds) {
    assert.ok(voice.localLine(kind).length > 0, `${kind} 应有兜底台词`);
  }
});

test('提示词包含人设、触发说明、当下状态与最近对话', () => {
  const msgs = voice.buildVoiceMessages({
    kind: 'feed',
    cfg: ONLINE,
    store: {
      readRecent: (n) =>
        [{ time: '10:00', activity: '写代码', app: 'Code', isWorking: true, detail: '调试投喂逻辑' }].slice(0, n)
    },
    dialogue: { recent: () => [{ role: 'pet', kind: 'bubble', text: '刚才那句' }] }
  });
  assert.equal(msgs.length, 2);
  assert.ok(msgs[0].content.includes('PERSONA_LOAD'));
  assert.ok(msgs[0].content.includes('投喂'));
  assert.ok(msgs[1].content.includes('刚才那句'));
  assert.ok(msgs[1].content.includes('调试投喂逻辑'));
  assert.ok(!/必须调用|工具门控/.test(msgs[0].content));
});

test('云端连不上：回落本地台词（source=local）', async () => {
  const r = await voice.composeLine({
    kind: 'poke',
    cfg: { model: { apiKey: 'bad', model: 'm', baseUrl: 'http://127.0.0.1:9/v1' }, companion: {} },
    store: { readRecent: () => [] },
    dialogue: null
  });
  assert.equal(r.source, 'local');
  assert.ok(r.text.length > 0);
});

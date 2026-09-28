import test from 'node:test';
import assert from 'node:assert/strict';
import notes from '../src/main/context/notes.js';

const CFG = { companion: { bubbles: true, visible: true, quietHours: { start: 23, end: 6 } } };

test('similarity：换标点算同一句，不同内容分低', () => {
  assert.ok(notes.similarity('哼，又在敲代码呀。', '哼，又在敲代码呀！') > 0.8);
  assert.ok(notes.similarity('又在敲代码呀', '桌面安静下来了') < 0.2);
});

test('ensureFreshNote：新鲜的原样保留', () => {
  const kept = notes.ensureFreshNote('这个报错看着挺唬人，其实就是少个分号。', ['刚才在看视频'], {
    category: 'coding',
    rng: () => 0
  });
  assert.equal(kept, '这个报错看着挺唬人，其实就是少个分号。');
});

test('ensureFreshNote：与最近重复 → 换一句本地台词', () => {
  const recent = ['这段逻辑绕来绕去，你倒是挺有耐心的。'];
  const out = notes.ensureFreshNote(recent[0], recent, { category: 'coding', rng: () => 0 });
  assert.notEqual(out, recent[0]);
  assert.ok(out.length >= 4);
});

test('ensureFreshNote：最近尾巴用太多 → 换掉尾巴句', () => {
  const recent = ['（甩甩尾巴）嗯。', '尾巴轻轻拍了下桌面。'];
  const out = notes.ensureFreshNote('哼，尾巴都等你摇酸啦。', recent, { category: 'idle', rng: () => 0.5 });
  assert.equal(notes.TAIL_RE.test(out), false);
});

test('ensureFreshNote：空内容走本地兜底', () => {
  const out = notes.ensureFreshNote('', [], { category: 'terminal', rng: () => 0.3 });
  assert.ok(out.includes('命令') || out.includes('终端') || out.includes('小问题'));
});

test('shouldSpeakNote：正常说 / 开关 / 安静时段 / 冷却 / 去重', () => {
  const evt = { note: '在写代码呀', isWorking: true };
  assert.equal(notes.shouldSpeakNote({ cfg: CFG, evt, hour: 15, recentPetLines: [] }).speak, true);
  const off = { companion: { ...CFG.companion, speakNotes: false } };
  assert.equal(notes.shouldSpeakNote({ cfg: off, evt, hour: 15 }).reason, 'notes-off');
  assert.equal(notes.shouldSpeakNote({ cfg: CFG, evt, hour: 23 }).reason, 'quiet');
  assert.equal(
    notes.shouldSpeakNote({ cfg: CFG, evt, hour: 15, now: 2 * 60 * 1000, lastNoteAt: 1000 }).reason,
    'cooldown'
  );
  assert.equal(
    notes.shouldSpeakNote({ cfg: CFG, evt, hour: 15, recentPetLines: ['在写代码呀'] }).reason,
    'duplicate'
  );
  assert.equal(notes.shouldSpeakNote({ cfg: CFG, evt: { note: '' }, hour: 15 }).reason, 'no-note');
});

test('shouldSpeakNote：云端模式听模型的 speak 字段，本地只留 60 秒防刷屏', () => {
  const speaking = { note: '在写代码呀', isWorking: true, speak: true };
  const silent = { note: '在写代码呀', isWorking: true, speak: false };
  assert.equal(notes.shouldSpeakNote({ cfg: CFG, evt: silent, hour: 15, cloud: true }).reason, 'llm-silent');
  assert.equal(notes.shouldSpeakNote({ cfg: CFG, evt: speaking, hour: 15, cloud: true }).speak, true);
  assert.equal(
    notes.shouldSpeakNote({ cfg: CFG, evt: speaking, hour: 15, cloud: true, now: 30 * 1000, lastNoteAt: 1000 }).reason,
    'cooldown'
  );
  assert.equal(
    notes.shouldSpeakNote({ cfg: CFG, evt: speaking, hour: 23, cloud: true }).reason,
    'quiet'
  );
});

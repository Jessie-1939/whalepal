import test from 'node:test';
import assert from 'node:assert/strict';
import analyzer from '../src/main/context/analyzer.js';

test('窗口分类：常见应用', () => {
  assert.equal(analyzer.classifyWindow('app.py - Visual Studio Code', 'Code'), 'coding');
  assert.equal(analyzer.classifyWindow('main.cpp - Visual Studio', 'devenv'), 'coding');
  assert.equal(analyzer.classifyWindow('微信', 'WeChat'), 'chat');
  assert.equal(analyzer.classifyWindow('Steam', 'steam'), 'gaming');
  assert.equal(analyzer.classifyWindow('哔哩哔哩 (゜-゜)つロ 干杯~', 'chrome'), 'video');
  assert.equal(analyzer.classifyWindow('(1) 首页 - Google Chrome', 'chrome'), 'browsing');
  assert.equal(analyzer.classifyWindow('', 'explorer'), 'idle');
  assert.equal(analyzer.classifyWindow('Windows PowerShell', 'powershell'), 'terminal');
});

test('基础分析：isWorking 判定', () => {
  assert.equal(analyzer.basicAnalyze({ title: 'x.py - Visual Studio Code', process: 'Code' }).isWorking, true);
  assert.equal(analyzer.basicAnalyze({ title: '哔哩哔哩', process: 'chrome' }).isWorking, false);
  assert.equal(analyzer.basicAnalyze({ title: '', process: '' }).isWorking, false);
});

test('解析云端返回：剥离代码围栏与多余文本', () => {
  const p = analyzer.parseJsonLoose('```json\n{"activity":"写代码","category":"coding"}\n```');
  assert.equal(p.category, 'coding');
  const p2 = analyzer.parseJsonLoose('好的，结果如下：{"activity":"看视频"}，以上。');
  assert.equal(p2.activity, '看视频');
  assert.equal(analyzer.parseJsonLoose('这不是 JSON'), null);
});

test('云端结果归一化：非法 category / isWorking 兜底', () => {
  const r = analyzer.normalizeCloudResult(
    { activity: '在写代码', category: 'unknown-cat', isWorking: 'yes' },
    { title: 'x.py - Visual Studio Code', process: 'Code' }
  );
  assert.ok(analyzer.CATEGORIES.has(r.category));
  assert.equal(typeof r.isWorking, 'boolean');
  assert.equal(r.isWorking, true);
});

test('无 API Key 时 analyze 走基础感知（非模型降级）', async () => {
  const r = await analyzer.analyze({
    jpeg: Buffer.from('fake'),
    title: 'x.py - Visual Studio Code',
    process: 'Code',
    cfg: { model: { apiKey: '', baseUrl: 'https://example.com/v1', model: 'm' } }
  });
  assert.equal(r.source, 'basic');
  assert.equal(r.isWorking, true);
});

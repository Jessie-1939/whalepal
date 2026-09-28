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

test('无障碍文本参与本地分类（无 Key 时也能用上精确文本）', () => {
  assert.equal(analyzer.classifyWindow('未命名', '', ['Error: MODULE_NOT_FOUND - Visual Studio Code']), 'coding');
  assert.equal(analyzer.classifyWindow('新建标签页', 'chrome', ['npm test 通过了']), 'browsing');
});

test('基础分析：带无障碍文本时输出 detail / entities / topics', () => {
  const r = analyzer.basicAnalyze({
    title: 'app.py - Visual Studio Code',
    process: 'Code',
    texts: ['终端: npm test 失败', 'x']
  });
  assert.ok(r.detail.includes('前台应用'));
  assert.ok(r.detail.includes('界面文本'));
  assert.ok(r.entities.keywords.length > 0);
  assert.ok(Array.isArray(r.topics) && r.topics.length > 0);
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

test('云端结果归一化：detail / entities / topics 的截断与清洗', () => {
  const r = analyzer.normalizeCloudResult({
    activity: '写代码',
    category: 'coding',
    isWorking: true,
    detail: 'x'.repeat(200),
    entities: {
      project: 'p'.repeat(60),
      files: ['a.py', 'a.py', 'b.py', 'c.py', 'd.py'],
      keywords: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']
    },
    topics: ['论文', '论文', '毕设', '调试', '多余']
  });
  assert.equal(r.detail.length, 120);
  assert.equal(r.entities.project.length, 40);
  assert.deepEqual(r.entities.files, ['a.py', 'b.py']);
  assert.equal(r.entities.keywords.length, 6);
  assert.deepEqual(r.topics, ['论文', '毕设', '调试']);
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

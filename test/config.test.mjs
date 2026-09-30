import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigStore } from '../src/main/config.js';

/** 临时目录里放一个 config.json，跑完删掉（异步也等完成再删）。 */
async function withTempConfig(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whalepal-cfg-'));
  const file = path.join(dir, 'config.json');
  try {
    return await fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('config：外部改动过的字段不会在下次 update 时被内存旧值覆盖', async () => {
  await withTempConfig(async (file) => {
    fs.writeFileSync(
      file,
      JSON.stringify({ model: { preset: 'bailian', baseUrl: 'https://a.example/v1', apiKey: '', model: 'm1' } })
    );
    const store = new ConfigStore(file);
    assert.equal(store.get().model.preset, 'bailian');

    // 模拟"应用运行期间，用户/脚本在磁盘上把供应商切换成了 deepseek"
    await wait(20);
    fs.writeFileSync(
      file,
      JSON.stringify({ model: { preset: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'k', model: 'deepseek-flash' } })
    );

    // 应用随后因为别的原因写配置（例如退出前保存窗口位置）
    store.update({ window: { x: 10, y: 20 } });

    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.model.preset, 'deepseek', '外部写入的供应商应保留');
    assert.equal(saved.model.model, 'deepseek-flash');
    assert.equal(saved.window.x, 10, '本次改动也要落盘');
  });
});

test('config：正常路径下 update 仍然即时生效', async () => {
  await withTempConfig(async (file) => {
    const store = new ConfigStore(file);
    store.update({ companion: { name: '主人' }, context: { intervalSec: 5 } });
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.companion.name, '主人');
    assert.equal(saved.context.intervalSec, 15, '低于下限的间隔被夹到 15 秒');
  });
});

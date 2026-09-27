const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

/**
 * 「only one 文件夹」原则：
 * - 打包态：应用根目录 = exe 所在目录（zip / 绿色分发 => 代码与数据同在一个文件夹）
 * - 开发态：应用根目录 = 项目根目录
 * - 所有运行期数据（配置/事件/截图/Electron 缓存/日志/崩溃转储）全部收纳在 <应用根>/data 内，
 *   不写入系统图片、文档、AppData 等任何其他位置。
 */
function resolveAppRoot() {
  return app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..', '..');
}

const APP_ROOT = resolveAppRoot();
const DATA_ROOT = path.join(APP_ROOT, 'data');

function ensureDirs() {
  const dirs = [
    DATA_ROOT,
    path.join(DATA_ROOT, 'screenshots'),
    path.join(DATA_ROOT, 'electron'),
    path.join(DATA_ROOT, 'logs'),
    path.join(DATA_ROOT, 'crash'),
    path.join(DATA_ROOT, 'scripts')
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
  return dirs;
}

/** 必须在 app ready 之前调用：把 Electron/Chromium 的各类落盘路径收拢进 data/ 内。 */
function relocateElectronPaths() {
  app.setPath('userData', path.join(DATA_ROOT, 'electron'));
  app.setPath('sessionData', path.join(DATA_ROOT, 'electron'));
  app.setPath('crashDumps', path.join(DATA_ROOT, 'crash'));
  try {
    app.setAppLogsPath(path.join(DATA_ROOT, 'logs'));
  } catch (_) {
    // 旧版本 Electron 不支持时忽略
  }
}

function files() {
  return {
    config: path.join(DATA_ROOT, 'config.json'),
    growth: path.join(DATA_ROOT, 'growth.json'),
    usage: path.join(DATA_ROOT, 'usage.json'),
    dialogue: path.join(DATA_ROOT, 'dialogue.jsonl'),
    events: path.join(DATA_ROOT, 'events.jsonl'),
    latestShot: path.join(DATA_ROOT, 'screenshots', 'latest.jpg')
  };
}

module.exports = { APP_ROOT, DATA_ROOT, ensureDirs, relocateElectronPaths, files };

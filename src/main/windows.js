const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, screen, protocol } = require('electron');

const PET_W = 300;
const PET_H = 350;

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json'
};

function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function defaultPetPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: wa.x + wa.width - PET_W - 24,
    y: wa.y + wa.height - PET_H - 12
  };
}

// 与渲染层一致的“立绘可视区域”边距：允许立绘（而非窗口）贴到屏幕边。
const OVERHANG = { left: 32, top: 82, right: 32, bottom: 4 };

/** 把窗口位置钳制进当前显示器工作区（允许立绘贴边的少量越界），避免历史坐标越界。 */
function clampToWorkArea(pos, workArea = screen.getPrimaryDisplay().workArea) {
  return {
    x: Math.min(Math.max(pos.x, workArea.x - OVERHANG.left), workArea.x + workArea.width - PET_W + OVERHANG.right),
    y: Math.min(Math.max(pos.y, workArea.y - OVERHANG.top), workArea.y + workArea.height - PET_H + OVERHANG.bottom)
  };
}

/** whalepal://assets/<...>  → 桌宠素材目录；whalepal://data/<...> → 应用数据目录 */
function registerAssetProtocol(roots) {
  protocol.handle('whalepal', async (request) => {
    try {
      const url = new URL(request.url);
      const root = roots[url.hostname];
      if (!root) return new Response('not found', { status: 404 });
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root + path.sep) && file !== root) {
        return new Response('forbidden', { status: 403 });
      }
      const buf = fs.readFileSync(file); // asar 感知，打包后同样可读
      return new Response(buf, {
        headers: { 'content-type': mimeOf(file), 'cache-control': 'no-cache' }
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

/** 扫描 assets/poses/<姿势>/*.png|webp|gif|avif，得到 {姿势: [文件名...]} 清单。 */
function scanPoses(assetsDir) {
  const posesDir = path.join(assetsDir, 'poses');
  const poses = {};
  try {
    if (!fs.existsSync(posesDir)) return poses;
    for (const entry of fs.readdirSync(posesDir)) {
      const full = path.join(posesDir, entry);
      if (!fs.statSync(full).isDirectory()) continue;
      const files = fs
        .readdirSync(full)
        .filter((f) => /\.(png|webp|gif|avif)$/i.test(f))
        .sort();
      if (files.length) poses[entry] = files;
    }
  } catch {
    // 素材目录缺失时返回空清单，渲染层自动使用占位形象
  }
  return poses;
}

function createPetWindow({ preloadPath, htmlPath, position }) {
  const pos = clampToWorkArea(position && Number.isFinite(position.x) ? position : defaultPetPosition());
  const win = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: '鲸伴 WhalePal',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setResizable(false);
  // 尺寸自愈：若被系统/输入法等外力改变尺寸，立即恢复为桌宠规格
  win.on('resize', () => {
    const [w, h] = win.getSize();
    if (w !== PET_W || h !== PET_H) {
      try {
        win.setSize(PET_W, PET_H);
      } catch {
        // 忽略
      }
    }
  });
  win.loadFile(htmlPath);
  win.once('ready-to-show', () => win.showInactive());
  return win;
}

function createSettingsWindow({ preloadPath, htmlPath }) {
  const win = new BrowserWindow({
    width: 860,
    height: 720,
    minWidth: 680,
    minHeight: 560,
    title: '鲸伴 · 设置',
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.loadFile(htmlPath);
  return win;
}

function workAreaFor(win) {
  const bounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2)
  });
  return display.workArea;
}

module.exports = {
  PET_W,
  PET_H,
  registerAssetProtocol,
  scanPoses,
  createPetWindow,
  createSettingsWindow,
  workAreaFor,
  defaultPetPosition,
  clampToWorkArea
};

const fs = require('node:fs');
const { Tray, Menu, nativeImage } = require('electron');

function findIcon(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function createTray({ candidates, onTogglePet, onOpenSettings, onOpenDataDir, onQuit }) {
  const iconPath = findIcon(candidates);
  if (!iconPath) return null;
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('鲸伴 WhalePal · 桌面 AI 伙伴');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 / 隐藏小鲸', click: onTogglePet },
      { label: '打开设置', click: onOpenSettings },
      { label: '打开数据目录（全部数据都在这里）', click: onOpenDataDir },
      { type: 'separator' },
      { label: '退出鲸伴', click: onQuit }
    ])
  );
  tray.on('double-click', onOpenSettings);
  return tray;
}

module.exports = { createTray };

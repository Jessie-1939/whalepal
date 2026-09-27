const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, protocol, shell } = require('electron');

const { relocateElectronPaths, ensureDirs, DATA_ROOT, APP_ROOT, files } = require('./paths');
const { ConfigStore } = require('./config');
const { EventStore } = require('./context/store');
const { DialogueStore } = require('./context/dialogue');
const { evaluateProactiveGates, decideWithModel, TIMEOUT_LINE } = require('./context/proactive');
const { ContextEngine } = require('./context/engine');
const { CareManager } = require('./context/care');
const { capturePrimaryScreen } = require('./context/capture');
const { getActiveWindow } = require('./context/activeWindow');
const { registerAssetProtocol, scanPoses, createPetWindow, createSettingsWindow, defaultPetPosition } = require('./windows');
const { createTray } = require('./tray');
const { registerIpc } = require('./ipc');

const PET_HTML = path.join(__dirname, '..', 'renderer', 'pet', 'index.html');
const SETTINGS_HTML = path.join(__dirname, '..', 'renderer', 'settings', 'index.html');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const PET_ASSETS = path.join(__dirname, '..', 'renderer', 'pet', 'assets');

let rt = null;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

function firstPoseFile(poses) {
  for (const [pose, list] of Object.entries(poses)) {
    if (list.length) return path.join(PET_ASSETS, 'poses', pose, list[0]);
  }
  return null;
}

// 必须在 requestSingleInstanceLock / ready 之前：单实例锁文件也位于 userData 内，
// 先把落盘路径全部收拢进 data/，保证「only one 文件夹」。
relocateElectronPaths();
protocol.registerSchemesAsPrivileged([
  { scheme: 'whalepal', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!rt) return;
    rt.showPet();
    rt.openSettings();
  });

  app.whenReady().then(bootstrap).catch((err) => {
    console.error('[whalepal] fatal:', err);
    app.quit();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    try {
      if (rt?.petWin && !rt.petWin.isDestroyed()) {
        const b = rt.petWin.getBounds();
        rt.configStore.update({ window: { x: b.x, y: b.y } });
      }
      rt?.engine?.stop();
      rt?.care?.stop();
      if (rt?.proactiveTimer) clearInterval(rt.proactiveTimer);
    } catch {
      // 退出路径尽力而为
    }
  });
}

async function bootstrap() {
  ensureDirs();
  const configStore = new ConfigStore(files().config);
  const cfg = configStore.get();
  const store = new EventStore(files().events, cfg.context.maxEvents);
  const dialogue = new DialogueStore(files().dialogue, 400);
  const poses = scanPoses(PET_ASSETS);

  registerAssetProtocol({ assets: PET_ASSETS, data: DATA_ROOT });

  const petWin = createPetWindow({
    preloadPath: PRELOAD,
    htmlPath: PET_HTML,
    position: cfg.window.x === null ? defaultPetPosition() : { x: cfg.window.x, y: cfg.window.y }
  });

  let settingsWin = null;
  const openSettings = (tab) => {
    const focusTab = tab || 'companion';
    const sendTab = (win) => {
      if (win && !win.isDestroyed()) win.webContents.send('settings:goto', { tab: focusTab });
    };
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.show();
      settingsWin.focus();
      sendTab(settingsWin);
      return;
    }
    settingsWin = createSettingsWindow({ preloadPath: PRELOAD, htmlPath: SETTINGS_HTML });
    settingsWin.webContents.once('did-finish-load', () => sendTab(settingsWin));
    settingsWin.on('closed', () => {
      settingsWin = null;
    });
  };

  const showPet = () => {
    if (petWin.isDestroyed()) return;
    petWin.showInactive();
    petWin.setAlwaysOnTop(true, 'screen-saver');
  };
  const hidePet = () => {
    if (petWin.isDestroyed()) return;
    petWin.hide();
  };
  const broadcast = (channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };

  const care = new CareManager({
    config: configStore,
    emit: ({ tag }) => broadcast('care:line', { tag })
  });

  const engine = new ContextEngine({
    config: configStore,
    store,
    files: files(),
    capture: () => capturePrimaryScreen({ width: 1280, height: 720 }),
    activeWindow: () => getActiveWindow(),
    onEvent: (evt) => {
      broadcast('context:update', evt);
      care.onEvent(evt);
    }
  });

  // 主动搭话：默认沉默；只有云端模型显式调用 send_message 工具才会发送。
  const runProactive = async () => {
    const c = configStore.get();
    const now = Date.now();
    const gate = evaluateProactiveGates({
      cfg: c,
      now,
      hour: new Date().getHours(),
      lastEvent: engine.lastEvent,
      dialogue,
      hasKey: !!(c.model.apiKey && c.model.model && c.model.baseUrl)
    });
    if (!gate.allow) return { sent: false, reason: gate.reason };
    if (gate.mode === 'timeout') {
      dialogue.append({ role: 'pet', kind: 'timeout', text: TIMEOUT_LINE });
      broadcast('pet:bubble', { text: TIMEOUT_LINE, ms: 6000, kind: 'timeout' });
      return { sent: true, mode: 'timeout' };
    }
    const decision = await decideWithModel({ cfg: c, store, dialogue });
    if (decision.send) {
      dialogue.append({ role: 'pet', kind: 'proactive', text: decision.text });
      broadcast('pet:bubble', { text: decision.text, ms: 8000, kind: 'proactive' });
      return { sent: true, mode: 'model', text: decision.text };
    }
    return { sent: false, reason: decision.reason };
  };

  rt = {
    configStore,
    store,
    dialogue,
    engine,
    care,
    poses,
    files: files(),
    DATA_ROOT,
    APP_ROOT,
    petWin,
    openSettings,
    showPet,
    hidePet,
    broadcast,
    readGrowth: () => readJson(files().growth, { state: null, savedAt: 0 }),
    writeGrowth: (data) => {
      if (!data || typeof data !== 'object') return false;
      const payload = { state: data, savedAt: Date.now() };
      const size = JSON.stringify(payload).length;
      if (size > 256 * 1024) return false;
      return writeJson(files().growth, payload);
    },
    runProactive
  };

  registerIpc(rt);

  engine.start();
  care.start();
  rt.proactiveTimer = setInterval(() => {
    runProactive().catch(() => {});
  }, 5 * 60 * 1000);

  rt.tray = createTray({
    candidates: [
      path.join(PET_ASSETS, 'logo.png'),
      path.join(PET_ASSETS, 'icon.png'),
      firstPoseFile(poses),
      path.join(APP_ROOT, 'build', 'icons', 'whale-32.png')
    ].filter(Boolean),
    onTogglePet: () => {
      const visible = petWin.isVisible();
      configStore.update({ companion: { visible: !visible } });
      if (visible) hidePet();
      else showPet();
    },
    onOpenSettings: openSettings,
    onOpenDataDir: () => shell.openPath(DATA_ROOT),
    onQuit: () => app.quit()
  });

  if (!configStore.get().companion.visible) hidePet();

  // 冒烟测试：WHALEPAL_SMOKE=1 时执行一次完整感知链路后退出
  if (process.env.WHALEPAL_SMOKE === '1') {
    setTimeout(async () => {
      try {
        const res = await engine.captureOnce(true);
        console.log('SMOKE_RESULT ' + JSON.stringify(res).slice(0, 600));
      } catch (err) {
        console.log('SMOKE_ERROR ' + String(err?.message || err).slice(0, 300));
      }
      app.quit();
    }, 2500);
  }

  // 窗口自检：WHALEPAL_DEBUG_CAPTURE=1 时打印坐标并抓取桌宠窗口内容后退出
  if (process.env.WHALEPAL_DEBUG_CAPTURE === '1') {
    setTimeout(async () => {
      try {
        const { screen } = require('electron');
        console.log('WORKAREA ' + JSON.stringify(screen.getPrimaryDisplay().workArea));
        console.log('SCREENSIZE ' + JSON.stringify(screen.getPrimaryDisplay().size));
        console.log('SCALEFACTOR ' + screen.getPrimaryDisplay().scaleFactor);
        console.log('PETBOUNDS ' + JSON.stringify(petWin.getBounds()));
        const probe = await petWin.webContents.executeJavaScript(
          `JSON.stringify({
            cls: document.body.className,
            innerW: innerWidth,
            innerH: innerHeight,
            bubbleTop: getComputedStyle(document.getElementById('bubble')).top,
            bubbleText: document.getElementById('bubble').textContent.slice(0, 16),
            spriteBox: (() => {
              const el = !document.getElementById('sprite').hidden ? document.getElementById('sprite') : document.getElementById('sprite-emoji');
              const r = el.getBoundingClientRect();
              return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
            })()
          })`
        );
        console.log('RENDERER ' + probe);
        const img = await petWin.webContents.capturePage();
        fs.writeFileSync(path.join(DATA_ROOT, 'pet-capture.png'), img.toPNG());
        const shot = await capturePrimaryScreen({ width: 1280, height: 720 });
        if (shot) fs.writeFileSync(path.join(DATA_ROOT, 'debug-desktop.jpg'), shot.image.toJPEG(80));
        if (process.env.WHALEPAL_DEBUG_SETTINGS === '1') {
          openSettings(process.env.WHALEPAL_DEBUG_SETTINGS_TAB || undefined);
          const sw = BrowserWindow.getAllWindows().find((w) => w !== petWin);
          if (sw) {
            await new Promise((resolve) => {
              if (sw.webContents.isLoading()) sw.webContents.once('did-finish-load', resolve);
              else resolve();
            });
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const simg = await sw.webContents.capturePage();
            fs.writeFileSync(path.join(DATA_ROOT, 'settings-capture.png'), simg.toPNG());
          }
        }
        console.log('CAPTURE_SAVED');
      } catch (err) {
        console.log('CAPTURE_ERROR ' + String(err?.message || err).slice(0, 300));
      }
      app.quit();
    }, 4000);
  }
}

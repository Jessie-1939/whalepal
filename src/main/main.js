const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, protocol, shell } = require('electron');

const { relocateElectronPaths, ensureDirs, DATA_ROOT, APP_ROOT, files } = require('./paths');
const { ConfigStore } = require('./config');
const { EventStore } = require('./context/store');
const { DialogueStore } = require('./context/dialogue');
const { SummaryStore } = require('./context/summaries');
const { evaluateProactiveGates, decideWithModel, generateTrialLine, TIMEOUT_LINE } = require('./context/proactive');
const { ContextEngine } = require('./context/engine');
const { CareManager } = require('./context/care');
const { shouldSpeakNote } = require('./context/notes');
const { buildEntityMemory } = require('./context/entities');
const { DshBridge } = require('./context/dshBridge');
const { capturePrimaryScreen } = require('./context/capture');
const { getActiveWindow, getUiText } = require('./context/activeWindow');
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
  // 隐私加固：关闭 Chromium 的后台联网（连通性探测 / 组件更新 / 同步 / 崩溃上报等），
  // 保证除「用户配置的模型端点」外，应用不会发起任何网络请求。
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-sync');
  app.commandLine.appendSwitch('no-pings');
  app.commandLine.appendSwitch('disable-breakpad');
  app.commandLine.appendSwitch('disable-crash-reporter');

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
  const summaries = new SummaryStore(files().summaries);
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

  // 跨天实体记忆（纯本地聚合）：给主动搭话与手动试跑提供"最近一直在忙什么"
  const memoryText = () => {
    try {
      return buildEntityMemory(store, { days: 7 }).text || '';
    } catch {
      return '';
    }
  };

  // 把感知到的「观察」在桌面上说出来（此前只写进设置页，主人几乎看不到她开口）。
  // 节流与去重由 notes.shouldSpeakNote 决定：工作中 8 分钟、其余 3 分钟一条，安静时段不说。
  const maybeSpeakNote = (evt) => {
    const c = configStore.get();
    const lastNote = dialogue.lastOfKind('note');
    const decision = shouldSpeakNote({
      cfg: c,
      evt,
      now: Date.now(),
      hour: new Date().getHours(),
      lastNoteAt: lastNote ? lastNote.ts : 0,
      // 云端事件：说与不说由模型自己判断（speak 字段）；离线事件：退回本地节奏规则
      cloud: evt.source === 'cloud',
      recentPetLines: dialogue
        .recent(20)
        .filter((e) => e.role === 'pet')
        .map((e) => e.text)
    });
    if (!decision.speak) return;
    dialogue.append({ role: 'pet', kind: 'note', text: evt.note });
    broadcast('pet:bubble', { text: evt.note, ms: 8000, kind: 'note' });
  };

  const engine = new ContextEngine({
    config: configStore,
    store,
    files: files(),
    capture: () => capturePrimaryScreen({ width: 1280, height: 720 }),
    activeWindow: () => getActiveWindow(),
    uiText: (aw) => (aw && aw.process ? getUiText({ process: aw.process }) : []),
    onEvent: (evt) => {
      broadcast('context:update', evt);
      care.onEvent(evt);
      maybeSpeakNote(evt);
    }
  });

  // DSH 桥接：装上 dsh-whalepal-bridge 插件后，桌宠直接拿到 agent 的真实状态
  // （不再只靠截屏猜）；没装 / DSH 没开时这个回环端口安静闲置。
  const dsh = new DshBridge({
    config: configStore,
    onState: (state) => {
      rt.dshState = state;
      broadcast('dsh:state', state);
    }
  });

  // 主动搭话：默认沉默；只有云端模型显式调用 send_message 工具才会发送。
  const runProactive = async ({ trial = false } = {}) => {
    const c = configStore.get();
    const now = Date.now();
    const hasKey = !!(c.model.apiKey && c.model.model && c.model.baseUrl);
    const gate = evaluateProactiveGates({
      cfg: c,
      now,
      hour: new Date().getHours(),
      lastEvent: engine.lastEvent,
      dialogue,
      hasKey
    });
    if (!trial && !gate.allow) {
      rt.proactiveStatus = { at: now, sent: false, reason: gate.reason, trial: false };
      return { sent: false, reason: gate.reason };
    }
    if (trial && !hasKey) {
      rt.proactiveStatus = { at: now, sent: false, reason: 'no-cloud-key', trial: true };
      return { sent: false, reason: 'no-cloud-key' };
    }
    if (trial) {
      // 手动试跑：主人明确要求她说一句 → 直接生成（自主搭话仍走工具门控）
      try {
        const text = await generateTrialLine({ cfg: c, store, dialogue, memory: memoryText() });
        if (!text) throw new Error('empty');
        dialogue.append({ role: 'pet', kind: 'proactive', text });
        broadcast('pet:bubble', { text, ms: 8000, kind: 'proactive' });
        rt.proactiveStatus = { at: now, sent: true, reason: 'trial', text, trial: true };
        return { sent: true, mode: 'trial', text };
      } catch (err) {
        rt.proactiveStatus = { at: now, sent: false, reason: 'cloud-error', trial: true };
        return { sent: false, reason: 'cloud-error', error: String(err?.message || err).slice(0, 120) };
      }
    }
    if (!trial && gate.mode === 'timeout') {
      dialogue.append({ role: 'pet', kind: 'timeout', text: TIMEOUT_LINE });
      broadcast('pet:bubble', { text: TIMEOUT_LINE, ms: 6000, kind: 'timeout' });
      rt.proactiveStatus = { at: now, sent: true, reason: 'timeout-signal', text: TIMEOUT_LINE, trial: false };
      return { sent: true, mode: 'timeout' };
    }
    const decision = await decideWithModel({ cfg: c, store, dialogue, trial, memory: memoryText() });
    if (decision.send) {
      dialogue.append({ role: 'pet', kind: 'proactive', text: decision.text });
      broadcast('pet:bubble', { text: decision.text, ms: 8000, kind: 'proactive' });
      rt.proactiveStatus = { at: now, sent: true, reason: 'ok', text: decision.text, trial };
      return { sent: true, mode: 'model', text: decision.text };
    }
    rt.proactiveStatus = { at: now, sent: false, reason: decision.reason, trial };
    return { sent: false, reason: decision.reason };
  };

  rt = {
    configStore,
    store,
    dialogue,
    summaries,
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
    runProactive,
    proactiveStatus: null,
    dsh,
    dshState: null
  };
  dsh.start();

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
    setTimeout(() => {
      try {
        console.log('PETBOUNDS_START ' + JSON.stringify(petWin.getBounds()));
      } catch {
        // 忽略
      }
    }, 1500);
    const delay = Number(process.env.WHALEPAL_DEBUG_DELAY_MS) || 4000;
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
            idleActions: (window.__whalePalDebug && window.__whalePalDebug.idleActions) || 0,
            spriteSrc: (document.getElementById('sprite').getAttribute('src') || '').split('/').slice(-2).join('/'),
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
            await sw.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)');
            await new Promise((resolve) => setTimeout(resolve, 400));
            const simg = await sw.webContents.capturePage();
            fs.writeFileSync(path.join(DATA_ROOT, 'settings-capture.png'), simg.toPNG());
          }
        }
        console.log('CAPTURE_SAVED');
      } catch (err) {
        console.log('CAPTURE_ERROR ' + String(err?.message || err).slice(0, 300));
      }
      app.quit();
    }, delay);
  }

  // 主动搭话自检：WHALEPAL_DEBUG_PROACTIVE=1 时立即执行一次判断（绕过时间类门控）并截图气泡
  if (process.env.WHALEPAL_DEBUG_PROACTIVE === '1') {
    setTimeout(async () => {
      const res = await runProactive({ trial: true });
      console.log('PROACTIVE_TRIAL ' + JSON.stringify(res).slice(0, 300));
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try {
        const img = await petWin.webContents.capturePage();
        fs.writeFileSync(path.join(DATA_ROOT, 'proactive-capture.png'), img.toPNG());
      } catch {
        // 忽略
      }
      setTimeout(() => app.quit(), 1500);
    }, 4000);
  }

  // README 动图素材：WHALEPAL_DEBUG_FRAMES=<帧数> 时按固定间隔抓取桌宠窗口内容帧
  if (process.env.WHALEPAL_DEBUG_FRAMES) {
    const count = Math.max(2, Number(process.env.WHALEPAL_DEBUG_FRAMES) || 12);
    const intervalMs = Number(process.env.WHALEPAL_DEBUG_FRAME_MS) || 350;
    const outDir = path.join(DATA_ROOT, 'gif-frames');
    fs.mkdirSync(outDir, { recursive: true });
    setTimeout(async () => {
      for (let i = 0; i < count; i++) {
        try {
          const img = await petWin.webContents.capturePage();
          fs.writeFileSync(path.join(outDir, `frame-${String(i).padStart(2, '0')}.png`), img.toPNG());
        } catch {
          // 忽略
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      console.log('FRAMES_SAVED ' + outDir);
      app.quit();
    }, 3000);
  }
}

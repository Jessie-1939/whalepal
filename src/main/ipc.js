const { ipcMain, app, shell } = require('electron');
const fs = require('node:fs');
const { workAreaFor, PET_W, PET_H } = require('./windows');
const chat = require('./context/chat');
const calendar = require('./context/calendar');
const { computeStorageStats } = require('./context/stats');
const { MODEL_PRESETS } = require('./config');
const { capturePrimaryScreen } = require('./context/capture');

function registerIpc(rt) {
  const { configStore, store, engine, dialogue, summaries, files, DATA_ROOT, APP_ROOT, broadcast } = rt;

  // ---- 配置 ----
  ipcMain.handle('config:get', () => configStore.get());
  ipcMain.handle('config:presets', () => MODEL_PRESETS);
  ipcMain.handle('config:set', (_e, patch) => {
    const cfg = configStore.update(patch || {});
    if (patch && patch.context) engine.reschedule();
    if (patch && patch.companion && patch.companion.visible !== undefined) {
      if (cfg.companion.visible) rt.showPet();
      else rt.hidePet();
    }
    broadcast('config:changed', cfg);
    return cfg;
  });

  // ---- 桌宠窗口控制 ----
  ipcMain.handle('pet:get-bounds', () => rt.petWin.getBounds());
  ipcMain.handle('pet:get-workarea', () => workAreaFor(rt.petWin));
  ipcMain.handle('pet:move', (_e, { x, y }) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      // 注意：在 150% 等缩放下，高频 setPosition 会让窗口尺寸逐次 +1px（Electron 取整缺陷），
      // 因此移动一律使用 setBounds 显式带上正确尺寸。
      rt.petWin.setBounds({ x: Math.round(x), y: Math.round(y), width: PET_W, height: PET_H });
    }
  });
  ipcMain.handle('pet:set-ignore-mouse', (_e, ignore) => {
    rt.petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.handle('pet:save-position', (_e, { x, y }) => {
    if (Number.isFinite(x) && Number.isFinite(y)) configStore.update({ window: { x: Math.round(x), y: Math.round(y) } });
  });
  ipcMain.handle('pet:open-settings', (_e, opts) => rt.openSettings(opts && opts.tab));
  ipcMain.handle('context:calendar', (_e, { year, month } = {}) => {
    const now = new Date();
    const y = Number(year) || now.getFullYear();
    const m = Number(month) || now.getMonth() + 1;
    const mm = String(m).padStart(2, '0');
    const events = store.readRange(`${y}-${mm}-01`, `${y}-${mm}-31`);
    const fallbackMs = (Number(configStore.get().context.intervalSec) || 60) * 1000;
    return calendar.aggregateMonth(events, y, m, { fallbackMs });
  });
  ipcMain.handle('context:day', (_e, dateKey) => {
    const key = String(dateKey || '');
    const fallbackMs = (Number(configStore.get().context.intervalSec) || 60) * 1000;
    return calendar.aggregateDay(store.dayEvents(key), { fallbackMs });
  });
  ipcMain.handle('context:day-summary', (_e, dateKey) =>
    chat.summaryForDay(String(dateKey || ''), { store, cfg: configStore.get(), dialogue, summaries })
  );
  ipcMain.handle('pet:hide', () => {
    configStore.update({ companion: { visible: false } });
    rt.hidePet();
  });
  ipcMain.handle('pet:set-visible', (_e, visible) => {
    configStore.update({ companion: { visible: !!visible } });
    if (visible) rt.showPet();
    else rt.hidePet();
  });

  // ---- 素材与养成 ----
  ipcMain.handle('assets:list', () => rt.poses);
  ipcMain.handle('growth:get', () => rt.readGrowth());
  ipcMain.handle('growth:save', (_e, data) => rt.writeGrowth(data));

  // ---- 上下文 ----
  ipcMain.handle('context:now', () => engine.lastEvent);
  ipcMain.handle('context:recent', (_e, n) => {
    const count = Math.min(50, Math.max(1, Number(n) || 12));
    return store.readRecent(count);
  });
  ipcMain.handle('context:capture-now', () => engine.captureOnce(true));
  ipcMain.handle('context:stats', () => {
    const f = files;
    let eventBytes = 0;
    let imageBytes = 0;
    try {
      eventBytes = fs.statSync(f.events).size;
    } catch {
      // 首次运行
    }
    try {
      imageBytes = fs.statSync(f.latestShot).size;
    } catch {
      // 未保留截图
    }
    const storage = computeStorageStats({
      eventBytes,
      eventCount: store.count,
      imageBytes,
      intervalSec: configStore.get().context.intervalSec,
      activeDays: store.dates().length || 1
    });
    return {
      ...store.stats(),
      usage: engine.usage,
      busyMinutes: engine.busyMinutes(),
      storage
    };
  });
  ipcMain.handle('context:summary', async () => chat.summary({ store, cfg: configStore.get(), dialogue }));

  // ---- 对话与模型 ----
  ipcMain.handle('chat:ask', async (_e, question) => {
    broadcast('companion:asked', true);
    const res = await chat.ask(question, {
      store,
      cfg: configStore.get(),
      dialogue,
      summaries,
      // 只有「现在/此刻」类问题才现场截一张图给云端模型（图片只在需要“看”的时刻进场）
      captureNow: async () => {
        const shot = await capturePrimaryScreen({ width: 1280, height: 720 });
        return shot ? shot.image.toJPEG(72) : null;
      }
    });
    dialogue.append({ role: 'user', kind: 'chat', text: String(question || '') });
    dialogue.append({ role: 'pet', kind: 'chat-reply', text: res.answer });
    return res;
  });
  ipcMain.handle('model:test', () => chat.testModel(configStore.get()));

  // ---- 对话记忆（渲染层每次说出可见台词/关键互动时调用）----
  ipcMain.handle('dialogue:record', (_e, entry) => dialogue.append(entry || {}));

  // ---- 数据与系统 ----
  ipcMain.handle('data:clear', () => {
    store.clear();
    dialogue.clear();
    summaries.clear();
    return true;
  });
  ipcMain.handle('data:info', () => ({ dataDir: DATA_ROOT, appRoot: APP_ROOT }));
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    dataDir: DATA_ROOT,
    appRoot: APP_ROOT
  }));
  ipcMain.handle('app:open-data-dir', () => shell.openPath(DATA_ROOT));
  ipcMain.handle('app:show-pet', () => {
    configStore.update({ companion: { visible: true } });
    rt.showPet();
  });
  ipcMain.handle('app:get-autostart', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('app:set-autostart', (_e, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath,
      args: app.isPackaged ? [] : [APP_ROOT]
    });
    configStore.update({ system: { autostart: !!enabled } });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('app:quit', () => app.quit());
}

module.exports = { registerIpc };

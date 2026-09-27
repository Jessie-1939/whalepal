const { ipcMain, app, shell } = require('electron');
const { workAreaFor, PET_W, PET_H } = require('./windows');
const chat = require('./context/chat');

function registerIpc(rt) {
  const { configStore, store, engine, dialogue, DATA_ROOT, APP_ROOT, broadcast } = rt;

  // ---- 配置 ----
  ipcMain.handle('config:get', () => configStore.get());
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
  ipcMain.handle('pet:open-settings', () => rt.openSettings());
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
  ipcMain.handle('context:stats', () => ({
    ...store.stats(),
    usage: engine.usage,
    busyMinutes: engine.busyMinutes()
  }));
  ipcMain.handle('context:summary', async () => chat.summary({ store, cfg: configStore.get(), dialogue }));

  // ---- 对话与模型 ----
  ipcMain.handle('chat:ask', async (_e, question) => {
    broadcast('companion:asked', true);
    const res = await chat.ask(question, { store, cfg: configStore.get(), dialogue });
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

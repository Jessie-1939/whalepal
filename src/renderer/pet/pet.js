/* 桌宠渲染层：窗口移动 / 拖拽惯性 / 姿势切换 / 气泡 / 特效 / 右键菜单 / 上下文联动。 */
(function () {
  const api = window.whalePal;
  const core = window.WhaleCore;
  const linesLib = window.WhaleLines;
  const poseMap = window.WhalePoseMap;
  const $ = (id) => document.getElementById(id);

  const sprite = $('sprite');
  const emoji = $('sprite-emoji');
  const bubble = $('bubble');
  const menu = $('menu');
  const pet = $('pet');

  const EMOJI = { idle: '🐋', work: '💻', sleep: '😴', happy: '😊', shy: '😳', eat: '🍰', celebrate: '🎉', carried: '🫧', angry: '💢', walk: '🐋', failure: '🥺', success: '✨' };

  let cfg = null;
  let workArea = { x: 0, y: 0, width: 1280, height: 720 };
  let poses = {};
  let state = core.createWhale(null);
  let lastContext = null;
  let dragging = false;
  let drag = null;
  let glide = null;
  let pos = { x: 0, y: 0 };
  let visualWalk = false;
  let currentPose = null;
  let ignoreMouse = null;
  let bubbleTimer = null;
  let saveTimer = null;
  let lastMouse = { x: -1, y: -1 };
  const clicks = [];
  const wander = { mode: 'pause', until: 0, vx: 0, vy: 0, turnAt: 0 };

  // ── 行为节奏（参考 dsh-whale-musume）──
  // 待机小动作：不移动，只在原地换姿势图（喝咖啡 / 伸懒腰 / 摸鱼…）
  const IDLE_ACTION_NAMES = [
    'daily-coffee', 'daily-stretch', 'daily-fishing', 'daily-picnic', 'daily-eat',
    'daily-cooking', 'daily-pajama', 'daily-shower', 'daily-painting', 'daily-gaming',
    'meme-music', 'cool-shades', 'wink', 'curious', 'greet'
  ];
  const IDLE_ACTION_MIN_GAP_MS = 45 * 1000;
  const IDLE_ACTION_MAX_GAP_MS = 110 * 1000;
  const AFK_MS = 3 * 60 * 1000; // 3 分钟无互动 → 原地打盹
  let idleOverride = null; // { name, until }
  let idleActionCount = 0;
  let nextIdleActionAt = performance.now() + 20000 + Math.random() * 30000;
  let lastInteractionAt = Date.now();
  let lastSignal = 'none';
  let lastSignalAt = 0;
  let lastWorkKey = '';
  // 供调试自检读取（无副作用）
  window.__whalePalDebug = {
    get idleActions() {
      return idleActionCount;
    }
  };

  const W = () => window.innerWidth;
  const H = () => window.innerHeight;

  // 立绘在窗口内的实际可视区域（默认按 #pet 容器：236×264、bottom 4px、水平居中）。
  // 拖拽/漫游边界按“立绘贴边”计算而不是“窗口贴边”，
  // 这样立绘本体可以真正贴到屏幕四边（窗口允许适度超出屏幕外）。
  let visualBox = { left: 32, top: 82, right: 268, bottom: 346 };

  function measureBox() {
    const el = !sprite.hidden ? sprite : emoji;
    const r = el.getBoundingClientRect();
    if (r.width > 8 && r.height > 8) {
      visualBox = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
  }

  function clampPos(p) {
    const wa = workArea;
    return {
      x: Math.min(Math.max(p.x, wa.x - visualBox.left), wa.x + wa.width - visualBox.right),
      y: Math.min(Math.max(p.y, wa.y - visualBox.top), wa.y + wa.height - visualBox.bottom)
    };
  }

  function isQuiet(hour = new Date().getHours()) {
    return core.isNightHour(hour, (cfg && cfg.companion.quietHours) || { start: 23, end: 6 });
  }

  // ---------- 姿势 ----------
  function pickPoseFile(pose) {
    const list = (poses && poses[pose]) || [];
    // 待机小动作：动作槽位优先按内容偏好挑选
    if (pose === 'idle' && idleOverride) {
      const hit = list.find((f) => f.startsWith(idleOverride.name));
      if (hit) return hit;
    }
    // work / idle 走确定性映射（同一屏幕内容 → 同一姿势）；互动姿势保留随机
    return poseMap.chooseFile(pose, lastContext, list, Math.random);
  }

  // 动势换图：旧图快速下压 → 在最重的一帧换图 → 新图弹起（点击反应则瞬间切换）
  function swapSprite(src, soft) {
    if (!soft || !sprite.getAttribute('src')) {
      sprite.src = src;
      return;
    }
    try {
      sprite.getAnimations().forEach((a) => a.cancel());
      const down = sprite.animate(
        [
          { transform: 'translateY(0) scale(1)' },
          { transform: 'translateY(12px) scale(0.86, 0.92)' }
        ],
        { duration: 110, easing: 'ease-in', fill: 'forwards' }
      );
      down.finished
        .then(() => {
          down.cancel();
          sprite.src = src;
          sprite.animate(
            [
              { transform: 'translateY(18px) scale(0.88, 0.94)' },
              { transform: 'translateY(0) scale(1)' }
            ],
            { duration: 240, easing: 'cubic-bezier(.34,1.3,.64,1)' }
          );
        })
        .catch(() => {
          sprite.src = src;
        });
    } catch {
      sprite.src = src;
    }
  }

  function applyPose(pose, soft = true) {
    if (currentPose === pose) return;
    currentPose = pose;
    document.body.dataset.pose = pose;
    const file = pickPoseFile(pose);
    if (file) {
      sprite.hidden = false;
      emoji.hidden = true;
      swapSprite(`whalepal://assets/poses/${pose}/${encodeURIComponent(file)}`, soft);
    } else {
      sprite.hidden = true;
      emoji.hidden = false;
      emoji.textContent = EMOJI[pose] || '🐋';
      measureBox();
    }
  }

  sprite.addEventListener('load', measureBox);

  function refreshPose(soft = true) {
    applyPose(visualWalk && state.phase === 'idle' ? 'walk' : state.pose, soft);
  }

  // ---------- 气泡 / 特效 ----------
  function showBubble(text, ms = 5000, opts = {}) {
    if (!cfg || !cfg.companion.bubbles || !text) return;
    // 说出口的话进对话记忆，保证之后的问答/主动搭话「记得自己刚说过什么」
    if (opts.record !== false) {
      api.invoke('dialogue:record', { role: 'pet', kind: opts.kind || 'bubble', text });
    }
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
  }

  function spawnFx(kind) {
    const layer = $('fx-layer');
    const n = kind === 'stars' ? 10 : 8;
    const glyph = kind === 'hearts' ? '💗' : kind === 'stars' ? '⭐' : '🫧';
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'fx';
      s.textContent = glyph;
      s.style.left = 20 + Math.random() * 60 + '%';
      s.style.top = 30 + Math.random() * 40 + '%';
      s.style.animationDelay = (Math.random() * 0.25).toFixed(2) + 's';
      layer.appendChild(s);
      setTimeout(() => s.remove(), 1700);
    }
  }

  function pushDiary(text) {
    state.diary.push({ ts: Date.now(), text });
    if (state.diary.length > 80) state.diary = state.diary.slice(-80);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.invoke('growth:save', state), 1500);
  }

  // 主人的关键互动也进对话记忆（供主动搭话判断「主人有没有在理我」）
  function noteUserAction(text) {
    api.invoke('dialogue:record', { role: 'user', kind: 'action', text });
  }

  function runAction(a) {
    switch (a.type) {
      case 'pose':
        // 点击/互动反应瞬间切换；状态类切换（工作/待机/打盹）走动势过渡
        refreshPose(state.phase !== 'react');
        break;
      case 'say':
        showBubble(a.text, a.ms);
        break;
      case 'fx':
        spawnFx(a.value);
        break;
      case 'achievement':
        showBubble(`🏅 解锁成就：${a.title}`, 6000);
        spawnFx('stars');
        pushDiary(`解锁成就「${a.title}」`);
        break;
      case 'levelUp':
        showBubble(`${linesLib.pick(linesLib.Lines.levelUp)} 羁绊 Lv${a.level}！`, 6000);
        spawnFx('stars');
        pushDiary(`羁绊升级到 Lv${a.level}`);
        break;
      case 'restore':
        setTimeout(() => dispatch({ type: 'react-done' }), a.ms);
        break;
    }
  }

  function dispatch(event) {
    const res = core.handle(state, event, { rng: Math.random, lines: linesLib.Lines });
    state = res.state;
    for (const a of res.actions) runAction(a);
    scheduleSave();
  }

  // ---------- 窗口移动 ----------
  function moveTo(p) {
    pos = p;
    syncEdgeClass();
    api.invoke('pet:move', { x: p.x, y: p.y });
  }

  // 立绘贴近屏幕顶边时，气泡翻到身体下方，避免被屏幕裁掉。
  // 注意：启动与窗口尺寸变化时也要同步，不能只在移动时判断。
  function syncEdgeClass() {
    document.body.classList.toggle('bubble-below', pos.y < workArea.y + 2);
  }

  function snapAndSave() {
    const EDGE = 12;
    const wa = workArea;
    let p = { ...pos };
    if (p.x + visualBox.left - wa.x < EDGE) p.x = wa.x - visualBox.left;
    if (wa.x + wa.width - (p.x + visualBox.right) < EDGE) p.x = wa.x + wa.width - visualBox.right;
    if (p.y + visualBox.top - wa.y < EDGE) p.y = wa.y - visualBox.top;
    if (wa.y + wa.height - (p.y + visualBox.bottom) < EDGE) p.y = wa.y + wa.height - visualBox.bottom;
    p = clampPos(p);
    if (p.x !== pos.x || p.y !== pos.y) moveTo(p);
    else pos = p;
    api.invoke('pet:save-position', { x: pos.x, y: pos.y });
  }

  function tickWander(now, dt) {
    if (!cfg || !cfg.companion.walk || dragging || glide || state.phase !== 'idle') {
      if (visualWalk) {
        visualWalk = false;
        refreshPose();
      }
      return;
    }
    if (wander.mode === 'pause') {
      if (visualWalk) {
        visualWalk = false;
        refreshPose();
      }
      if (now >= wander.until) {
        wander.mode = 'walk';
        wander.until = now + 3000 + Math.random() * 5000;
        wander.turnAt = now + 1500;
        const ang = Math.random() * Math.PI * 2;
        const speed = 34 + Math.random() * 26;
        wander.vx = Math.cos(ang) * speed;
        wander.vy = Math.sin(ang) * speed * 0.45;
      }
      return;
    }
    if (!visualWalk) {
      visualWalk = true;
      refreshPose();
    }
    if (now > wander.turnAt) {
      const t = (Math.random() - 0.5) * 0.9;
      const nx = wander.vx * Math.cos(t) - wander.vy * Math.sin(t);
      const ny = wander.vx * Math.sin(t) + wander.vy * Math.cos(t);
      wander.vx = nx;
      wander.vy = ny;
      wander.turnAt = now + 1500 + Math.random() * 1500;
    }
    const dtS = dt / 1000;
    let next = { x: pos.x + wander.vx * dtS, y: pos.y + wander.vy * dtS };
    if (next.x <= workArea.x - visualBox.left || next.x >= workArea.x + workArea.width - visualBox.right) {
      wander.vx *= -1;
      next.x = pos.x;
    }
    if (next.y <= workArea.y - visualBox.top || next.y >= workArea.y + workArea.height - visualBox.bottom) {
      wander.vy *= -1;
      next.y = pos.y;
    }
    moveTo(clampPos(next));
    if (now >= wander.until) {
      wander.mode = 'pause';
      wander.until = now + 4000 + Math.random() * 6000;
      visualWalk = false;
      refreshPose();
    }
  }

  function tickGlide(now) {
    if (!glide) return;
    const dt = Math.min(50, now - glide.last);
    glide.last = now;
    const frames = dt / 16.67;
    let next = { x: pos.x + glide.vx * frames, y: pos.y + glide.vy * frames };
    if (next.x <= workArea.x - visualBox.left || next.x >= workArea.x + workArea.width - visualBox.right) glide.vx *= -0.35;
    if (next.y <= workArea.y - visualBox.top || next.y >= workArea.y + workArea.height - visualBox.bottom) glide.vy *= -0.35;
    next = clampPos(next);
    moveTo(next);
    const decay = Math.pow(0.92, frames);
    glide.vx *= decay;
    glide.vy *= decay;
    if (Math.hypot(glide.vx, glide.vy) < 0.05) {
      glide = null;
      snapAndSave();
    }
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    tickWander(now, dt);
    tickGlide(now);
    tickIdleActions(now);
    requestAnimationFrame(frame);
  }

  // 待机小动作调度：原地换图，播放几秒后回到基础待机（不移动窗口）
  function tickIdleActions(now) {
    if (!cfg.companion.idleActions) {
      if (idleOverride) {
        idleOverride = null;
        currentPose = null;
        refreshPose(true);
      }
      return;
    }
    if (idleOverride && now >= idleOverride.until) {
      idleOverride = null;
      nextIdleActionAt = now + IDLE_ACTION_MIN_GAP_MS + Math.random() * (IDLE_ACTION_MAX_GAP_MS - IDLE_ACTION_MIN_GAP_MS);
      currentPose = null;
      refreshPose(true);
      return;
    }
    if (idleOverride || now < nextIdleActionAt) return;
    if (state.phase !== 'idle' || dragging || glide || visualWalk) return;
    const list = (poses && poses.idle) || [];
    const names = IDLE_ACTION_NAMES.filter((n) => list.some((f) => f.startsWith(n)));
    if (!names.length) {
      nextIdleActionAt = now + 60000;
      return;
    }
    // 小动作优先贴合当前内容（看视频→摸鱼、游戏→打游戏…），没有偏好再随机
    const preferred = poseMap.preferredIdleAction(lastContext && lastContext.category);
    const name = preferred && names.includes(preferred) ? preferred : names[Math.floor(Math.random() * names.length)];
    idleOverride = {
      name,
      until: now + 4500 + Math.random() * 3500
    };
    idleActionCount += 1;
    currentPose = null;
    refreshPose(true);
  }

  // 互动时间戳 + 从打盹中唤醒（参考 afk 逻辑：夜间睡眠不受影响）
  function markInteraction() {
    lastInteractionAt = Date.now();
    if (state.phase === 'sleep' && state.napAfk) {
      dispatch({ type: 'wake', hour: new Date().getHours(), quiet: cfg.companion.quietHours });
    }
  }

  // 屏幕信号：报错 / 完成 时给出对应反应（同一信号只反应一次 + 2 分钟冷却，避免花活）
  function maybeSignalReact(evt) {
    const sig = evt && evt.signal ? evt.signal : 'none';
    if (sig === 'none' || sig === lastSignal) return;
    const now = Date.now();
    if (now - lastSignalAt < 2 * 60 * 1000) return;
    lastSignal = sig;
    lastSignalAt = now;
    dispatch({ type: 'signal', kind: sig });
  }

  // ---------- 鼠标穿透 ----------
  function updateIgnore(x, y) {
    if (dragging || x < 0 || y < 0) return;
    let over = false;
    try {
      const el = document.elementFromPoint(x, y);
      over = !!(el && el.closest && el.closest('#pet, #menu'));
    } catch {
      over = false;
    }
    const ignore = !over;
    if (ignore !== ignoreMouse) {
      ignoreMouse = ignore;
      api.invoke('pet:set-ignore-mouse', ignore);
    }
  }

  window.addEventListener(
    'mousemove',
    (e) => {
      lastMouse = { x: e.clientX, y: e.clientY };
      updateIgnore(e.clientX, e.clientY);
    },
    { passive: true }
  );

  // ---------- 拖拽 / 点击 ----------
  function zoneFromEvent(e) {
    const rect = pet.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / Math.max(1, rect.width);
    const ry = (e.clientY - rect.top) / Math.max(1, rect.height);
    if (ry < 0.38 && rx > 0.2 && rx < 0.8) return 'head';
    if (rx > 0.7) return 'tail';
    return 'belly';
  }

  function registerClick(e) {
    markInteraction();
    const now = performance.now();
    clicks.push(now);
    while (clicks.length && now - clicks[0] > 1200) clicks.shift();
    const zone = zoneFromEvent(e);
    dispatch({ type: 'click', zone });
    noteUserAction(`摸了摸小鲸的${zone === 'head' ? '头' : zone === 'belly' ? '肚子' : '尾巴'}`);
    if (clicks.length >= 3) {
      clicks.length = 0;
      dispatch({ type: 'triple' });
      noteUserAction('连点了小鲸三次');
    }
  }

  pet.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    markInteraction();
    dragging = true;
    drag = { sx: e.screenX, sy: e.screenY, wx: pos.x, wy: pos.y, moved: false, samples: [] };
    api.invoke('pet:set-ignore-mouse', false);
    document.body.classList.add('dragging');
    dispatch({ type: 'drag-start' });
    try {
      pet.setPointerCapture(e.pointerId);
    } catch {
      // 忽略
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!dragging || !drag) return;
    const dx = e.screenX - drag.sx;
    const dy = e.screenY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const p = clampPos({ x: drag.wx + dx, y: drag.wy + dy });
    moveTo(p);
    drag.samples.push({ t: performance.now(), x: p.x, y: p.y });
    if (drag.samples.length > 8) drag.samples.shift();
  });

  window.addEventListener('pointerup', (e) => {
    if (!dragging || !drag) return;
    dragging = false;
    document.body.classList.remove('dragging');
    const wasDrag = drag.moved;
    const samples = drag.samples.slice();
    drag = null;
    if (wasDrag) {
      let vx = 0;
      let vy = 0;
      if (samples.length >= 2) {
        const a = samples[0];
        const b = samples[samples.length - 1];
        const dt = Math.max(16, b.t - a.t);
        vx = ((b.x - a.x) / dt) * 16;
        vy = ((b.y - a.y) / dt) * 16;
      }
      if (Math.hypot(vx, vy) > 0.25) glide = { vx, vy, last: performance.now() };
      else snapAndSave();
      dispatch({
        type: 'drag-end',
        stillWorking: !!(lastContext && lastContext.isWorking),
        hour: new Date().getHours(),
        quiet: cfg.companion.quietHours
      });
      noteUserAction('把小鲸拎起来搬了个家');
    } else {
      registerClick(e);
    }
    updateIgnore(lastMouse.x, lastMouse.y);
  });

  // ---------- 右键菜单 ----------
  function doMenuAction(action) {
    markInteraction();
    switch (action) {
      case 'pat':
        dispatch({ type: 'click', zone: 'head' });
        break;
      case 'feed':
        dispatch({ type: 'feed' });
        noteUserAction('投喂了小鲸一份小点心');
        break;
      case 'praise':
        dispatch({ type: 'praise' });
        noteUserAction('夸了夸小鲸');
        break;
      case 'poke':
        dispatch({ type: 'poke' });
        noteUserAction('戳了小鲸一下');
        break;
      case 'summary':
        askSummary();
        break;
      case 'calendar':
        api.invoke('pet:open-settings', { tab: 'calendar' });
        break;
      case 'settings':
        api.invoke('pet:open-settings');
        break;
      case 'reset':
        api.invoke('pet:get-workarea').then((wa) => {
          workArea = wa;
          moveTo(clampPos({ x: wa.x + wa.width - W() - 24, y: wa.y + wa.height - H() - 12 }));
          api.invoke('pet:save-position', { x: pos.x, y: pos.y });
        });
        break;
      case 'toggle-walk':
        api.invoke('config:set', { companion: { walk: !cfg.companion.walk } }).then((c) => {
          cfg = c;
          showBubble(cfg.companion.walk ? '好，我继续溜达～' : '那我乖乖待着。', 3000);
        });
        break;
      case 'hide':
        api.invoke('pet:hide');
        break;
    }
  }

  async function askSummary() {
    showBubble('让我整理一下今天的记录…', 3000);
    try {
      const r = await api.invoke('context:summary');
      showBubble(String(r.text || '').replace(/\n+/g, ' ').slice(0, 150), 12000);
    } catch {
      showBubble('记录整理失败了，稍后再试试。', 4000);
    }
  }

  pet.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    menu.classList.add('show');
    const mw = menu.offsetWidth || 160;
    const mh = menu.offsetHeight || 280;
    menu.style.left = Math.min(Math.max(6, e.clientX), W() - mw - 6) + 'px';
    menu.style.top = Math.min(Math.max(6, e.clientY), H() - mh - 6) + 'px';
    updateIgnore(lastMouse.x, lastMouse.y);
  });

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    menu.classList.remove('show');
    doMenuAction(btn.dataset.action);
    updateIgnore(lastMouse.x, lastMouse.y);
  });

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (menu.classList.contains('show') && !menu.contains(e.target)) menu.classList.remove('show');
    },
    true
  );

  // ---------- 初始化 ----------
  async function init() {
    cfg = await api.invoke('config:get');
    workArea = await api.invoke('pet:get-workarea');
    poses = await api.invoke('assets:list');
    const growth = await api.invoke('growth:get');
    state = core.createWhale(growth && growth.state ? growth.state : null);
    const bounds = await api.invoke('pet:get-bounds');
    pos = { x: bounds.x, y: bounds.y };
    applyPose(state.pose);
    syncEdgeClass();
    requestAnimationFrame(frame);

    const hour = new Date().getHours();
    if (!isQuiet(hour)) {
      setTimeout(() => {
        const greet = linesLib.pick(linesLib.greetingFor(hour));
        const spawn = linesLib.pick(linesLib.Lines.spawn);
        showBubble(greet || spawn, 5200);
      }, 1200);
    }
    dispatch({ type: 'tick', hour, quiet: cfg.companion.quietHours, deltaMs: 0 });

    setInterval(() => {
      dispatch({ type: 'tick', hour: new Date().getHours(), quiet: cfg.companion.quietHours, deltaMs: 30000 });
      // 参考 afk 逻辑：3 分钟无互动且主人不在工作 → 原地打盹（不移动）
      if (
        state.phase === 'idle' &&
        !(lastContext && lastContext.isWorking) &&
        Date.now() - lastInteractionAt > AFK_MS
      ) {
        dispatch({ type: 'nap' });
      }
    }, 30000);

    api.on('context:update', (evt) => {
      lastContext = evt;
      dispatch({
        type: 'context',
        isWorking: evt.isWorking,
        hour: new Date().getHours(),
        quiet: cfg.companion.quietHours
      });
      // 同一屏幕内容 → 同一工作姿势；类别变化时才换图（闲聊已改为主进程工具门控下发）
      if (state.phase === 'work') {
        const key = String(evt.category || '');
        if (key !== lastWorkKey) {
          lastWorkKey = key;
          currentPose = null;
          refreshPose(true);
        }
      } else {
        lastWorkKey = '';
      }
      maybeSignalReact(evt);
    });
    api.on('care:line', ({ tag }) => dispatch({ type: 'care', tag }));
    api.on('pet:bubble', ({ text, ms, kind }) => showBubble(text, ms || 8000, { record: false, kind }));
    api.on('config:changed', (c) => {
      cfg = c;
    });
    api.on('companion:asked', () => {
      markInteraction();
      dispatch({ type: 'asked' });
    });

    window.addEventListener('resize', () => {
      pos = clampPos(pos);
      moveTo(pos);
      syncEdgeClass();
    });
  }

  init().catch((err) => {
    console.error('[pet] init failed:', err);
    showBubble('初始化出了点问题：' + String((err && err.message) || err).slice(0, 80), 8000);
  });
})();

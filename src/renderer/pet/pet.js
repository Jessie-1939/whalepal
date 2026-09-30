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
  const WORK_ROTATE_MS = 4 * 60 * 1000; // 工作姿势：组内每 4 分钟轮换一格
  const IDLE_ROTATE_MS = 15 * 60 * 1000; // 待机基础图：每 15 分钟轮换一格
  const AFK_MS = 3 * 60 * 1000; // 3 分钟无互动 → 原地打盹
  let idleOverride = null; // { name, until }
  let idleActionCount = 0;
  let nextIdleActionAt = performance.now() + 20000 + Math.random() * 30000;
  let lastInteractionAt = Date.now();
  let lastSignal = 'none';
  let lastSignalAt = 0;
  let lastWorkKey = '';
  let lastWorkRotateIdx = Math.floor(Date.now() / WORK_ROTATE_MS);
  let lastIdleRotateIdx = Math.floor(Date.now() / IDLE_ROTATE_MS);
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
    // work/idle：语义组内按分钟级序号轮换；互动姿势保留随机
    const rotate = pose === 'work' ? Math.floor(Date.now() / WORK_ROTATE_MS) : Math.floor(Date.now() / IDLE_ROTATE_MS);
    return poseMap.chooseFile(pose, lastContext, list, Math.random, rotate);
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

  // ── 台词：正常情况由云端模型现写，连不上云再用本地台词库兜底 ──
  function cloudReady() {
    return !!(cfg && cfg.model && cfg.model.apiKey && cfg.model.model && cfg.model.baseUrl);
  }

  async function sayViaModel(kind, fallbackText, ms) {
    if (!cloudReady()) {
      if (fallbackText) showBubble(fallbackText, ms);
      return;
    }
    try {
      const r = await api.invoke('voice:say', { kind, fallback: fallbackText });
      const text = (r && r.text) || fallbackText;
      if (text) showBubble(text, ms);
    } catch {
      if (fallbackText) showBubble(fallbackText, ms);
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
        if (a.kind) sayViaModel(a.kind, a.text, a.ms);
        else showBubble(a.text, a.ms);
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

  // ── 动画循环：按需运行（此前是常驻 60fps，桌宠闲着也一直烧 CPU / GPU）──
  // 只有「甩出去的惯性滑行」和「开启走动且在散步」才需要逐帧；
  // 其余时间用 1 秒一次的低频 tick（待机小动作、散步调度），主线程不再被 60fps 唤醒。
  let lastFrame = performance.now();
  let rafId = 0;

  function needsAnimation() {
    if (glide) return true;
    // 走动模式下也只有"正在移动"那几秒需要逐帧；停顿期间交给 1s 心跳
    return !!(cfg && cfg.companion.walk && !dragging && state.phase === 'idle' && wander.mode === 'walk');
  }

  function frame(now) {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    tickWander(now, dt);
    tickGlide(now);
    rafId = needsAnimation() ? requestAnimationFrame(frame) : 0;
  }

  function ensureAnimation() {
    if (!rafId && needsAnimation()) {
      lastFrame = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  function lowFreqTick() {
    const now = performance.now();
    tickIdleActions(now);
    tickBreath(now);
    // 走动模式：停顿期间由低频 tick 决定何时开始下一段，真正移动时才交给 rAF
    if (!rafId && cfg && cfg.companion.walk && !glide) {
      tickWander(now, 1000);
      ensureAnimation();
    }
  }

  // 偶尔「呼吸」一下：不再常驻 60fps 动画（那是 CPU/GPU 空转的大头），
  // 改为每 18–40 秒做一次 1.6s 的轻微起伏——看得见活着，又不烧机器。
  const BREATH_MIN_MS = 18 * 1000;
  const BREATH_MAX_MS = 40 * 1000;
  let nextBreathAt = performance.now() + 6000 + Math.random() * 6000;
  function tickBreath(now) {
    if (now < nextBreathAt) return;
    nextBreathAt = now + BREATH_MIN_MS + Math.random() * (BREATH_MAX_MS - BREATH_MIN_MS);
    if (!cfg || dragging || glide || visualWalk || state.phase !== 'idle') return;
    try {
      pet.animate(
        [
          { transform: 'translateX(-50%) translateY(0)' },
          { transform: 'translateX(-50%) translateY(-5px)' },
          { transform: 'translateX(-50%) translateY(0)' }
        ],
        { duration: 1600, easing: 'ease-in-out' }
      );
    } catch {
      // 动画不可用时忽略：桌宠保持静止
    }
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
  // 命中判定用几何矩形（visualBox / 菜单矩形）而不是 elementFromPoint：
  // 后者每次 mousemove 都会触发布局计算，拖动鼠标时是实打实的卡顿来源。
  function pointOverPet(x, y) {
    if (menu.classList.contains('show')) {
      const r = menu.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    const pad = 4;
    return (
      x >= visualBox.left - pad &&
      x <= visualBox.right + pad &&
      y >= visualBox.top - pad &&
      y <= visualBox.bottom + pad
    );
  }

  function updateIgnore(x, y) {
    if (dragging || x < 0 || y < 0) return;
    const ignore = !pointOverPet(x, y);
    if (ignore !== ignoreMouse) {
      ignoreMouse = ignore;
      api.invoke('pet:set-ignore-mouse', ignore);
    }
  }

  // mousemove 合并到每帧一次：高频移动时不再逐条事件做命中判定
  let mouseRaf = 0;
  let mousePending = null;
  window.addEventListener(
    'mousemove',
    (e) => {
      lastMouse = { x: e.clientX, y: e.clientY };
      mousePending = lastMouse;
      if (!mouseRaf) {
        mouseRaf = requestAnimationFrame(() => {
          mouseRaf = 0;
          if (mousePending) updateIgnore(mousePending.x, mousePending.y);
        });
      }
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
      if (Math.hypot(vx, vy) > 0.25) {
        glide = { vx, vy, last: performance.now() };
        ensureAnimation(); // 只有在真的甩出去时才需要逐帧
      }
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
  /** 一级 / 二级菜单页切换（二级页承载"看看日历、打开设置、回到原位、隐藏"等低频项）。 */
  function showMenuView(view) {
    for (const v of menu.querySelectorAll('.menu-view')) v.hidden = v.dataset.view !== view;
  }

  /**
   * 把菜单放进视口：宠物窗口只有 300×350，贴着屏幕边时菜单很容易超出窗口被系统裁掉。
   * 这里以「面板完整可见」为第一优先，超出就贴边（配合 CSS 的 max-height 兜底）。
   */
  function placeMenu(x, y, w, h) {
    const pad = 6;
    const left = Math.max(pad, Math.min(x, W() - w - pad));
    const top = Math.max(pad, Math.min(y, H() - h - pad));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

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
      case 'speak':
        speakNow();
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

  // 手动让她说一句：走主动搭话的手动试跑（真实内容由主进程广播 pet:bubble 显示）
  async function speakNow() {
    showBubble('唔……让我想想说什么。', 2200);
    try {
      const r = await api.invoke('proactive:run');
      if (!r || !r.sent) {
        showBubble(
          r && r.reason === 'no-cloud-key' ? '还没配置云端模型的钥匙，我暂时想不到新话题。' : '……现在没什么好说的，先陪你待着。',
          4000
        );
      }
    } catch {
      showBubble('说话失败啦，稍后再试试。', 4000);
    }
  }

  pet.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenuView('main');
    menu.classList.add('show');
    const mw = menu.offsetWidth || 160;
    const mh = menu.offsetHeight || 280;
    placeMenu(e.clientX, e.clientY, mw, mh);
    updateIgnore(lastMouse.x, lastMouse.y);
  });

  menu.addEventListener('click', (e) => {
    if (e.target.closest('[data-secondary]')) {
      // 切到二级页后面板高度会变，重新贴着视口放一次，避免换页后被裁
      showMenuView('more');
      placeMenu(lastMouse.x, lastMouse.y, menu.offsetWidth || 160, menu.offsetHeight || 200);
      updateIgnore(lastMouse.x, lastMouse.y);
      return;
    }
    if (e.target.closest('[data-back]')) {
      showMenuView('main');
      placeMenu(lastMouse.x, lastMouse.y, menu.offsetWidth || 160, menu.offsetHeight || 200);
      updateIgnore(lastMouse.x, lastMouse.y);
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    menu.classList.remove('show');
    showMenuView('main');
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
    // 低频心跳（1s）：待机小动作与散步调度；真正需要逐帧时再挂 rAF
    setInterval(lowFreqTick, 1000);
    ensureAnimation();

    // 自检（WHALEPAL_DEBUG_MENU=1）：把右键菜单量出来，用于排查"菜单被窗口裁掉"这类布局问题
    // （=2 时把菜单留在屏幕上，配合截图肉眼验收）
    const debugMenu = window.__WHALEPAL_DEBUG_MENU__;
    if (debugMenu) {
      setTimeout(() => {
        menu.classList.add('show');
        menu.style.left = '6px';
        menu.style.top = '6px';
        for (const view of ['main', 'more']) {
          showMenuView(view);
          const rect = menu.getBoundingClientRect();
          const box = { w: Math.round(rect.width), h: Math.round(rect.height) };
          console.log(
            `MENU_METRICS ${JSON.stringify({
              view,
              viewport: [W(), H()],
              menu: box,
              fits: box.h <= H() - 12 && box.w <= W() - 12,
              items: menu.querySelectorAll('button:not([hidden])').length
            })}`
          );
        }
        showMenuView('main');
        if (debugMenu >= 2) {
          // 模拟"贴着窗口底边右键"：菜单应自动上移、保持完整可见
          menu.classList.remove('show');
          lastMouse.x = 150;
          lastMouse.y = 300;
          const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 150, clientY: 300 });
          pet.dispatchEvent(evt);
          if (debugMenu === 3) showMenuView('more');
          api.invoke('pet:set-ignore-mouse', false).catch(() => {});
        }
      }, 800);
    }

    const hour = new Date().getHours();
    if (!isQuiet(hour)) {
      setTimeout(() => {
        const greet = linesLib.pick(linesLib.greetingFor(hour));
        const spawn = linesLib.pick(linesLib.Lines.spawn);
        sayViaModel('greeting', greet || spawn, 5200);
      }, 1200);
    }
    dispatch({ type: 'tick', hour, quiet: cfg.companion.quietHours, deltaMs: 0 });

    setInterval(() => {
      dispatch({ type: 'tick', hour: new Date().getHours(), quiet: cfg.companion.quietHours, deltaMs: 30000 });
      // 工作姿势组内轮换：内容不变也会缓慢换姿势，避免"一直一张"
      if (state.phase === 'work') {
        const idx = Math.floor(Date.now() / WORK_ROTATE_MS);
        if (idx !== lastWorkRotateIdx) {
          lastWorkRotateIdx = idx;
          currentPose = null;
          refreshPose(true);
        }
      }
      // 待机基础图慢轮换（小动作播放期间不动）
      if (state.phase === 'idle' && !idleOverride) {
        const idx = Math.floor(Date.now() / IDLE_ROTATE_MS);
        if (idx !== lastIdleRotateIdx) {
          lastIdleRotateIdx = idx;
          currentPose = null;
          refreshPose(true);
        }
      }
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
      // DSH 正在跑任务时以它为准（比截屏推断准得多），且 2 分钟内不让屏幕分析抢走姿势
      if (dshBusy && Date.now() - dshAt < 2 * 60 * 1000) return;
      lastContext = evt;
      dispatch({
        type: 'context',
        isWorking: evt.isWorking,
        hour: new Date().getHours(),
        quiet: cfg.companion.quietHours
      });
      // 内容所属语义组变化 → 立即换图；组内则交给上面的分钟级轮换
      if (state.phase === 'work') {
        const key = poseMap.workGroup(evt).key;
        const idx = Math.floor(Date.now() / WORK_ROTATE_MS);
        if (key !== lastWorkKey || idx !== lastWorkRotateIdx) {
          lastWorkKey = key;
          lastWorkRotateIdx = idx;
          currentPose = null;
          refreshPose(true);
        }
      } else {
        lastWorkKey = '';
      }
      maybeSignalReact(evt);
    });
    // ── DSH（DeepSeek Harness）桥接：agent 真实状态优先于截屏推断 ──
    // 装了 dsh-whalepal-bridge 插件时，她直接知道：在思考 / 在跑哪个工具 / 报错 / 等你确认 / 回合结束。
    let dshBusy = false;
    let dshAt = 0;
    function dshCategory(s) {
      const t = String((s && s.tool) || '');
      if (/bash|pwsh|shell|terminal|command|exec/i.test(t)) return 'terminal';
      if (/web|fetch|http|search|browse/i.test(t)) return 'browsing';
      if (/present|image|canvas|design/i.test(t)) return 'design';
      if (/todo|plan|goal|workflow|jobs|task/i.test(t)) return 'writing';
      if (/read/i.test(t)) return 'reading';
      return 'coding';
    }
    function dshWorking(s) {
      dshBusy = true;
      dshAt = Date.now();
      lastContext = {
        activity: s.tool ? `DSH · ${s.tool}` : 'DSH · 思考中',
        title: s.tool || '',
        category: dshCategory(s),
        detail: s.detail || '',
        isWorking: true,
        source: 'dsh'
      };
      dispatch({ type: 'context', isWorking: true, hour: new Date().getHours(), quiet: cfg.companion.quietHours });
      lastWorkKey = poseMap.workGroup(lastContext).key;
      lastWorkRotateIdx = Math.floor(Date.now() / WORK_ROTATE_MS);
      currentPose = null;
      refreshPose(true);
      markInteraction();
    }
    api.on('dsh:state', (s) => {
      if (!s || !s.state) return;
      dshAt = Date.now();
      switch (s.state) {
        case 'tool':
        case 'busy':
          dshWorking(s);
          break;
        case 'error':
          dshBusy = true;
          maybeSignalReact({ signal: 'error' });
          break;
        case 'turn-end':
          dshBusy = false;
          maybeSignalReact({ signal: 'success' });
          break;
        case 'waiting-approval':
          dshBusy = true;
          showBubble('DSH 在等你确认一下～', 6000);
          break;
        case 'idle':
        case 'session-start':
        default:
          dshBusy = false;
          dispatch({ type: 'context', isWorking: false, hour: new Date().getHours(), quiet: cfg.companion.quietHours });
          break;
      }
    });

    api.on('care:line', ({ tag }) => dispatch({ type: 'care', tag }));
    api.on('pet:bubble', ({ text, ms, kind, chunks }) => {
      // 长回答：切成几段依次说，像她真的在讲话，而不是一次糊一大段
      if (Array.isArray(chunks) && chunks.length) {
        let i = 0;
        const play = () => {
          if (i >= chunks.length) return;
          const c = String(chunks[i++] || '');
          if (!c) return play();
          const stay = Math.max(3200, Math.min(9000, c.length * 150));
          showBubble(c, stay, { record: false, kind });
          setTimeout(play, stay + 320);
        };
        play();
        return;
      }
      showBubble(text, ms || 8000, { record: false, kind });
    });
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

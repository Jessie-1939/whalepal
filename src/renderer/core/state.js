/**
 * 鲸伴桌宠状态机（纯函数，与表现层分离，可在 Node 中直接单测）。
 * 主状态：idle（待机）/ work（工作）/ sleep（睡眠）/ drag（拖拽）/ react（瞬时互动）
 * 漫游（walk 视觉）由 pet.js 依据 movement 决定，不进入核心状态。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WhaleCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LEVELS = [0, 30, 80, 160, 300, 520, 800];

  const ACHIEVEMENTS = {
    first_pat: { title: '初次摸头', desc: '第一次摸摸小鲸的头' },
    first_feed: { title: '投喂成功', desc: '第一次投喂小点心' },
    first_praise: { title: '夸夸好孩子', desc: '第一次夸夸小鲸' },
    triple_3: { title: '三连击', desc: '一口气连点三次' },
    first_ask: { title: '第一次被提问', desc: '第一次向小鲸提问上下文' },
    companion_60: { title: '陪伴一小时', desc: '累计陪伴满 60 分钟' },
    level_3: { title: '羁绊 Lv3', desc: '好感等级升到 Lv3' },
    care_night: { title: '深夜守护', desc: '收到一次深夜关怀' }
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function levelOf(affinity) {
    let lv = 1;
    for (let i = 1; i < LEVELS.length; i++) if (affinity >= LEVELS[i]) lv = i + 1;
    return lv;
  }

  function isNightHour(hour, quiet) {
    const start = (quiet && quiet.start) ?? 23;
    const end = (quiet && quiet.end) ?? 6;
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  }

  function createWhale(initial) {
    const base = {
      phase: 'idle',
      pose: 'idle',
      prevMain: 'idle',
      mood: 70,
      affinity: 0,
      satiety: 80,
      patCount: 0,
      feedCount: 0,
      praiseCount: 0,
      pokeCount: 0,
      tripleCount: 0,
      askCount: 0,
      careCount: 0,
      companionMs: 0,
      achievements: {},
      diary: [],
      lastReactionAt: 0,
      // AFK 打盹（参考 dsh-whale-musume 的 afk 状态）：无互动 3 分钟后原地小睡，
      // 任一互动即唤醒；夜间睡眠不算 napAfk，不会被互动"叫醒"到 idle。
      napAfk: false
    };
    const merged = Object.assign(base, (initial && { ...initial }) || {});
    merged.achievements = Object.assign({}, (initial && initial.achievements) || {});
    merged.diary = Array.isArray(merged.diary) ? merged.diary.slice(-80) : [];
    // 瞬时状态不入档：phase/pose 属于运行期状态，启动时一律从 idle 开始，
    // 由随后的 tick / context 事件重新决定（避免上次退出时的 work/sleep 被固化）。
    merged.phase = 'idle';
    merged.pose = 'idle';
    merged.prevMain = 'idle';
    return merged;
  }

  function handle(state, event, helpers) {
    const s = Object.assign({}, state, {
      achievements: Object.assign({}, state.achievements),
      diary: state.diary.slice()
    });
    const actions = [];
    const rng = (helpers && helpers.rng) || Math.random;
    const L = (helpers && helpers.lines) || {};
    const pick = (pool) => (pool && pool.length ? pool[Math.floor(rng() * pool.length)] : '');
    const say = (pool, ms = 5000) => {
      const text = pick(pool);
      if (text) actions.push({ type: 'say', text, ms });
    };
    const unlock = (id) => {
      if (!s.achievements[id]) {
        s.achievements[id] = Date.now();
        const a = ACHIEVEMENTS[id];
        actions.push({ type: 'achievement', id, title: a ? a.title : id });
      }
    };
    const gainAffinity = (n) => {
      const before = levelOf(s.affinity);
      s.affinity = Math.max(0, s.affinity + n);
      const after = levelOf(s.affinity);
      if (after > before) {
        actions.push({ type: 'levelUp', level: after });
        if (after >= 3) unlock('level_3');
      }
    };
    const react = (pose, ms = 2400) => {
      s.phase = 'react';
      s.pose = pose;
      s.lastReactionAt = Date.now();
      actions.push({ type: 'pose', pose });
      actions.push({ type: 'restore', ms });
    };
    const mainFor = (hour, quiet) => (isNightHour(hour, quiet) ? 'sleep' : 'idle');

    switch (event.type) {
      case 'context': {
        if (s.phase === 'drag' || s.phase === 'react') break;
        s.napAfk = false;
        if (event.isWorking) {
          s.prevMain = 'work';
          s.phase = 'work';
          s.pose = 'work';
          actions.push({ type: 'pose', pose: 'work' });
        } else {
          const main = mainFor(event.hour ?? new Date().getHours(), event.quiet);
          s.prevMain = main;
          s.phase = main;
          s.pose = main;
          actions.push({ type: 'pose', pose: main });
        }
        break;
      }

      case 'tick': {
        s.companionMs += event.deltaMs || 0;
        if (s.companionMs >= 60 * 60 * 1000) unlock('companion_60');
        if (s.phase === 'idle' || s.phase === 'sleep') {
          const main = mainFor(event.hour, event.quiet);
          if (main !== s.phase) {
            s.phase = main;
            s.pose = main;
            s.prevMain = main;
            s.napAfk = false;
            actions.push({ type: 'pose', pose: main });
          }
        }
        break;
      }

      case 'nap': {
        // 无互动打盹：仅在待机时进入
        if (s.phase === 'idle') {
          s.phase = 'sleep';
          s.pose = 'sleep';
          s.prevMain = 'sleep';
          s.napAfk = true;
          actions.push({ type: 'pose', pose: 'sleep' });
        }
        break;
      }

      case 'wake': {
        // 被互动唤醒：只从 AFK 打盹中醒来（夜间睡眠不受影响）
        if (s.phase === 'sleep' && s.napAfk) {
          const main = mainFor(event.hour ?? new Date().getHours(), event.quiet);
          s.napAfk = false;
          if (main === 'idle') {
            s.phase = 'idle';
            s.pose = 'idle';
            s.prevMain = 'idle';
            actions.push({ type: 'pose', pose: 'idle' });
          }
        }
        break;
      }

      case 'drag-start': {
        if (s.phase !== 'drag') s.prevMain = s.phase === 'react' ? s.prevMain : s.phase;
        s.phase = 'drag';
        s.pose = 'carried';
        actions.push({ type: 'pose', pose: 'carried' });
        break;
      }

      case 'drag-end': {
        const main = event.stillWorking ? 'work' : mainFor(event.hour ?? new Date().getHours(), event.quiet);
        s.napAfk = false;
        s.phase = main;
        s.pose = main === 'work' ? 'work' : main;
        s.prevMain = main;
        actions.push({ type: 'pose', pose: s.pose });
        break;
      }

      case 'click': {
        s.patCount += 1;
        s.mood = clamp(s.mood + 2, 0, 100);
        gainAffinity(1);
        const zone = event.zone || 'head';
        const pose = zone === 'head' ? 'shy' : 'happy';
        react(pose);
        actions.push({ type: 'fx', value: zone === 'head' ? 'hearts' : zone === 'belly' ? 'bubbles' : 'stars' });
        say((L.interaction && L.interaction[zone]) || [], 4500);
        unlock('first_pat');
        break;
      }

      case 'triple': {
        s.tripleCount += 1;
        s.mood = clamp(s.mood + 5, 0, 100);
        gainAffinity(3);
        react('celebrate', 2600);
        actions.push({ type: 'fx', value: 'stars' });
        say(L.triple || [], 6000);
        unlock('triple_3');
        break;
      }

      case 'feed': {
        s.feedCount += 1;
        s.satiety = clamp(s.satiety + 10, 0, 100);
        gainAffinity(2);
        react('eat');
        actions.push({ type: 'fx', value: 'hearts' });
        say(L.feed || []);
        unlock('first_feed');
        break;
      }

      case 'praise': {
        s.praiseCount += 1;
        s.mood = clamp(s.mood + 8, 0, 100);
        gainAffinity(2);
        react('happy');
        actions.push({ type: 'fx', value: 'stars' });
        say(L.praise || []);
        unlock('first_praise');
        break;
      }

      case 'poke': {
        s.pokeCount += 1;
        s.mood = clamp(s.mood - 5, 0, 100);
        react('angry');
        say(L.poke || []);
        break;
      }

      case 'care': {
        s.careCount += 1;
        if (event.tag === 'night') unlock('care_night');
        say((L.care && L.care[event.tag]) || [], 7000);
        break;
      }

      case 'chatter': {
        const pool = (L.context && L.context[event.category]) || L.context?.other || [];
        say(pool, 5000);
        break;
      }

      case 'asked': {
        s.askCount += 1;
        say(L.asked || [], 4000);
        unlock('first_ask');
        break;
      }

      case 'answer': {
        actions.push({ type: 'say', text: String(event.text || '').slice(0, 400), ms: 12000 });
        break;
      }

      case 'react-done': {
        if (s.phase === 'react') {
          const main = s.prevMain || 'idle';
          s.phase = main;
          s.pose = main;
          actions.push({ type: 'pose', pose: main });
        }
        break;
      }

      case 'signal': {
        // 屏幕信号反应（报错 / 完成）：由 pet.js 去重与冷却后触发，不打断拖拽。
        if (s.phase === 'drag') break;
        if (event.kind === 'error') {
          react('failure', 8000);
          say(L.signal?.error || [], 8000);
        } else if (event.kind === 'success') {
          react('success', 6000);
          say(L.signal?.success || [], 6000);
        }
        break;
      }
    }
    return { state: s, actions };
  }

  return { LEVELS, ACHIEVEMENTS, createWhale, handle, levelOf, isNightHour, clamp };
});

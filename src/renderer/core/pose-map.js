/**
 * 姿势决策（纯函数，可单元测试）：
 * 立绘既不"随机花活"，也不"永远一张"——而是**语义分组 + 慢节奏轮换**：
 *   - 先按屏幕理解结果（category / activity / title）确定语义组（如 coding → 调试组）；
 *   - 组内有 2–3 张语义相近的立绘，按 rotateIndex（分钟级）在组内轮换；
 *   - 空闲基础图同样有一个小分组（idle-cute / greet / curious）做更慢的轮换；
 *   - 互动姿势（摸头/投喂等）保留随机以有新鲜感。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WhalePoseMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WORK_GROUPS = {
    coding: ['work-debug', 'work-ram', 'tool'],
    terminal: ['tool', 'work-debug', 'work-ram'],
    deploy: ['work-deploy', 'work-celebrate'],
    meeting: ['work-meeting', 'work-slack-phone'],
    office: ['work-review', 'work-slack'],
    reading: ['work-review', 'work-pat'],
    writing: ['work-review', 'work-slack'],
    design: ['work-idea', 'work-pat'],
    deadline: ['work-deadline', 'work-boss'],
    other: ['work-review', 'work-boss', 'work-pat']
  };

  // 命中顺序：先特殊关键词（返回语义组 key），再按类别兜底
  const WORK_RULES = [
    [/部署|发布|上线|\bdeploy\b|\brelease\b/i, 'deploy'],
    [/会议|开会|meeting|zoom|teams|腾讯会议/i, 'meeting'],
    [/\bddl\b|deadline|截止|赶工/i, 'deadline'],
    [/设计|原型|方案|脑暴|brainstorm|\bidea\b|灵感/i, 'design'],
    [/调试|debug|报错|修复|\bfix\b|排查/i, 'coding'],
    [/命令行|终端|\bterminal\b|\bshell\b|命令提示符/i, 'terminal'],
    [/阅读|资料|读文献|\bread\b/i, 'reading'],
    [/文档|论文|写作|撰写|审阅|\breview\b/i, 'writing']
  ];

  const CATEGORY_TO_GROUP = {
    meeting: 'meeting',
    design: 'design',
    office: 'office',
    reading: 'reading',
    writing: 'writing',
    terminal: 'terminal',
    coding: 'coding'
  };

  const IDLE_ACTION_BY_CATEGORY = {
    video: 'daily-fishing',
    gaming: 'daily-gaming',
    browsing: 'daily-fishing',
    chat: 'daily-coffee',
    office: 'daily-coffee',
    coding: 'daily-stretch',
    reading: 'daily-stretch',
    design: 'daily-painting',
    meeting: 'daily-coffee',
    terminal: 'daily-stretch',
    other: 'daily-pajama'
  };

  const IDLE_BASE_GROUP = ['idle-cute', 'greet', 'curious'];

  /** 当前内容对应的语义组（key 用于判断"内容变没变"）。 */
  function workGroup(ctx) {
    const hay = `${ctx?.activity || ''} ${ctx?.title || ''}`;
    for (const [re, key] of WORK_RULES) {
      if (re.test(hay)) return { key, files: WORK_GROUPS[key] };
    }
    const key = CATEGORY_TO_GROUP[ctx?.category] || 'other';
    return { key, files: WORK_GROUPS[key] };
  }

  function preferredWorkFile(ctx) {
    return workGroup(ctx).files[0];
  }

  function preferredIdleAction(category) {
    return IDLE_ACTION_BY_CATEGORY[category] || '';
  }

  /**
   * 选图：work/idle 走"语义组 + rotateIndex 轮换"；其余互动姿势保留随机。
   * @param {number} rotateIndex 轮换序号（调用方按分钟级时钟计算）
   */
  function chooseFile(pose, ctx, list, rng, rotateIndex = 0) {
    if (!list || !list.length) return '';
    const baseOf = (f) => f.replace(/\.[^.]+$/, '');
    const pick = (name) => {
      if (!name) return '';
      // 精确文件名优先（避免 work-slack 命中 work-slack-phone），前缀兜底
      return list.find((f) => baseOf(f) === name) || list.find((f) => baseOf(f).startsWith(name)) || '';
    };
    if (pose === 'work') {
      const group = workGroup(ctx);
      for (let i = 0; i < group.files.length; i++) {
        const hit = pick(group.files[(rotateIndex + i) % group.files.length]);
        if (hit) return hit;
      }
      return list[0];
    }
    if (pose === 'idle') {
      return (
        pick(IDLE_BASE_GROUP[rotateIndex % IDLE_BASE_GROUP.length]) || pick('idle-cute') || list[0]
      );
    }
    return list[Math.floor((rng || Math.random)() * list.length)];
  }

  return {
    WORK_GROUPS,
    IDLE_BASE_GROUP,
    workGroup,
    preferredWorkFile,
    preferredIdleAction,
    chooseFile
  };
});

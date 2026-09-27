/**
 * 姿势决策（纯函数，可单元测试）：
 * 立绘不再"随机花活"，而是由屏幕理解结果（category / activity / title）确定性映射：
 *   - 工作姿势：代码→work-debug、会议→work-meeting、设计→work-idea、
 *     部署→work-deploy、DDL→work-deadline、文档阅读→work-review……
 *   - 待机小动作：按当前内容偏好（看视频→摸鱼、游戏→打游戏、设计→画画……）
 * 同一内容只会得到同一个姿势；变化时才换图。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WhalePoseMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // 命中顺序：先特殊关键词，再按类别兜底
  const WORK_RULES = [
    [/部署|发布|上线|\bdeploy\b|\brelease\b/i, 'work-deploy'],
    [/会议|开会|meeting|zoom|teams|腾讯会议/i, 'work-meeting'],
    [/\bddl\b|deadline|截止|赶工/i, 'work-deadline'],
    [/设计|原型|方案|脑暴|brainstorm|\bidea\b|灵感/i, 'work-idea'],
    [/调试|debug|报错|修复|\bfix\b|排查/i, 'work-debug']
  ];

  const WORK_BY_CATEGORY = {
    meeting: 'work-meeting',
    design: 'work-idea',
    office: 'work-review',
    reading: 'work-review',
    writing: 'work-review',
    terminal: 'work-debug',
    coding: 'work-debug'
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

  function preferredWorkFile(ctx) {
    const hay = `${ctx?.activity || ''} ${ctx?.title || ''}`;
    for (const [re, name] of WORK_RULES) {
      if (re.test(hay)) return name;
    }
    return WORK_BY_CATEGORY[ctx?.category] || 'work-review';
  }

  function preferredIdleAction(category) {
    return IDLE_ACTION_BY_CATEGORY[category] || '';
  }

  /**
   * 选图：work/idle 走确定性映射；其余互动姿势（摸头/投喂等）保留随机以有新鲜感。
   */
  function chooseFile(pose, ctx, list, rng) {
    if (!list || !list.length) return '';
    const pick = (name) => (name ? list.find((f) => f.startsWith(name)) : '');
    if (pose === 'work') return pick(preferredWorkFile(ctx)) || pick('work-review') || list[0];
    if (pose === 'idle') return pick('idle-cute') || list[0];
    return list[Math.floor((rng || Math.random)() * list.length)];
  }

  return { preferredWorkFile, preferredIdleAction, chooseFile, WORK_BY_CATEGORY, IDLE_ACTION_BY_CATEGORY };
});

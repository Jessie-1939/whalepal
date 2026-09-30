const fs = require('node:fs');

/** 云端模型预设（本项目不提供本地模型，模型分析全部走云端 OpenAI 兼容接口）。 */
const MODEL_PRESETS = {
  // 仓库内只放公共 DashScope 域名；「业务空间专属域名」属于个人信息，
  // 请在设置页替换为你的专属地址（只保存在本地 data/config.json，不入库）。
  bailian: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-omni-flash',
    extraBody: { modalities: ['text'], enable_thinking: false }
  },
  // DeepSeek 官方 API：deepseek-flash（= DeepSeek-V4.1-Flash）原生支持图片输入，1M 上下文。
  // 预设关掉思考模式：桌宠的屏幕理解是轻量任务，思考只烧输出 token 且慢 5 倍
  // （实测同一张截图：关思考 ~1.2s / 120 输出 token，默认思考 ~5.6s / 925 输出 token）。
  // 注意：DeepSeek 不吃百炼的 enable_thinking/modalities 参数，别照搬。
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    extraBody: { thinking: { type: 'disabled' } }
  },
  doubao: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-flash-250828' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: {}
};

const DEFAULTS = {
  companion: {
    enabled: true,
    visible: true,
    name: '主人',
    selfName: '小鲸',
    walk: false,
    bubbles: true,
    care: true,
    proactive: true,
    // 把每次感知到的「观察」在桌面上说出来（有节流：工作中 8 分钟、其余 3 分钟一条）
    speakNotes: true,
    idleActions: true,
    quietHours: { start: 23, end: 6 }
  },
  context: {
    enabled: true,
    intervalSec: 60,
    keepScreenshots: true,
    // 读取前台窗口无障碍树文本（本机只读，随分析请求作为精确文本提示；可关）
    uiText: true,
    maxEvents: 5000
  },
  // 云端模型配置：未填 API Key 时使用「基础感知」（非模型，仅窗口标题分类）
  model: {
    preset: 'bailian',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    model: 'qwen3.8-omni-flash',
    extraBody: { modalities: ['text'], enable_thinking: false }
  },
  system: {
    autostart: false
  },
  // DSH（DeepSeek Harness）桥接：只监听 127.0.0.1，接收 dsh-whalepal-bridge 插件推送的 agent 状态
  dsh: {
    enabled: true,
    port: 8787
  },
  window: { x: null, y: null }
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const key of Object.keys(extra || {})) {
    const v = extra[key];
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(out[key])) out[key] = deepMerge(out[key], v);
    else out[key] = v;
  }
  return out;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

class ConfigStore {
  constructor(file) {
    this.file = file;
    this.mtimeMs = 0;
    this.data = this._load();
  }

  /** 读取磁盘上的配置；顺带记下修改时间，用于识别"应用运行期间被外部改过"。 */
  _load() {
    try {
      this.mtimeMs = fs.statSync(this.file).mtimeMs;
      return deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      this.mtimeMs = 0;
      return clone(DEFAULTS);
    }
  }

  /**
   * 落盘前检查：如果应用运行期间磁盘上的配置被外部改过（手动编辑、脚本切换供应商……），
   * 先把它读回来再叠加本次改动，而不是拿内存里的旧值整个覆盖 —— 否则关窗口那一刻
   * 会把外部改动吞掉（本机实测踩过：切好的供应商被退出时写回旧值）。
   */
  _reloadIfChangedOnDisk() {
    try {
      const diskMtime = fs.statSync(this.file).mtimeMs;
      if (this.mtimeMs && diskMtime === this.mtimeMs) return;
      const disk = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = deepMerge(this.data, disk);
    } catch {
      // 文件不存在 / 正在被写坏：保持内存值，后面直接写覆盖
    }
  }

  get() {
    return clone(this.data);
  }

  update(patch) {
    this._reloadIfChangedOnDisk();
    this.data = deepMerge(this.data, patch || {});
    // 兜底约束：避免误配置导致高频截屏
    this.data.context.intervalSec = clamp(this.data.context.intervalSec, 15, 3600);
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    try {
      this.mtimeMs = fs.statSync(this.file).mtimeMs;
    } catch {
      this.mtimeMs = 0;
    }
    return this.get();
  }
}

module.exports = { ConfigStore, DEFAULTS, MODEL_PRESETS, deepMerge, clamp };

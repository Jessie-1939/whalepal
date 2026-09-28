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
    this.data = this._load();
  }

  _load() {
    try {
      return deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return clone(DEFAULTS);
    }
  }

  get() {
    return clone(this.data);
  }

  update(patch) {
    this.data = deepMerge(this.data, patch || {});
    // 兜底约束：避免误配置导致高频截屏
    this.data.context.intervalSec = clamp(this.data.context.intervalSec, 15, 3600);
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    return this.get();
  }
}

module.exports = { ConfigStore, DEFAULTS, MODEL_PRESETS, deepMerge, clamp };

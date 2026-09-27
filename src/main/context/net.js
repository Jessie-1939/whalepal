/**
 * 唯一网络出口（egress guard）。
 *
 * 隐私硬保证：全应用只有这一个模块允许发起对外请求，且**只允许请求当前配置的
 * 模型 Base URL**（http 仅限 localhost）。任何硬编码到第三方地址的调用都会在
 * 这里被拒绝，避免数据意外流向非配置端点。
 *
 * 可用 `rg "fetch\(" src/` 审计：除本文件外不应存在其它 fetch 调用点。
 */

function isAllowedUrl(url, cfg) {
  try {
    const base = String(cfg?.model?.baseUrl || '');
    if (!base) return false;
    const target = new URL(url);
    const allowed = new URL(base);
    // 本机网关（http://localhost / 127.0.0.1 / [::1]）不限制路径
    if (target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) return true;
    if (target.protocol !== 'https:' || target.host !== allowed.host) return false;
    const prefix = allowed.pathname.replace(/\/+$/, '');
    return target.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

async function guardedFetch(url, { cfg, timeoutMs = 30000, ...options } = {}) {
  if (!isAllowedUrl(url, cfg)) {
    throw new Error(`egress blocked: ${String(url).slice(0, 80)}`);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isAllowedUrl, guardedFetch };

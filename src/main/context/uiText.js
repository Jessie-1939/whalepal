/**
 * 无障碍树（UIA）文本摘录：本机只读，用来给云端分析补充「像素保证不了的精确文本」
 * ——文件名、报错原文、页面标题等。它不是 OCR：不识别像素，而是直接读取窗口控件自带的文本，
 * 没有额外模型调用、没有额外费用；截图仍是主要证据，这里只是随请求附带的提示。
 *
 * 实测（Windows 11 + pwsh 7，2026-09-28 本机）：
 *   - 原生应用（记事本）：199ms 返回 48 个控件、含完整报错 `找不到 E:\...\20260921.txt 文件。`；
 *   - Chromium 系（ChatGPT 桌面端 / Obsidian 等 Electron）：首次查询阻塞 10.7s 且返回空
 *     （Chrome 无障碍引擎冷启动）。
 * 因此调用侧必须硬超时 + 负缓存，本文件提供两个纯函数：filterUiTexts / createUiTextPolicy。
 */

const UI_TEXT_PS1 = String.raw`$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WhalePalUia {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@
$hwnd = [WhalePalUia]::GetForegroundWindow()
$items = New-Object System.Collections.Generic.List[string]
if ($hwnd -ne [IntPtr]::Zero) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($root) {
      $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($el in $all) {
        if ($items.Count -ge 40) { break }
        $n = $el.Current.Name
        if ($n -and $n.Length -ge 2 -and $n.Length -le 80) { [void]$items.Add($n) }
      }
    }
  } catch { }
}
Write-Output (ConvertTo-Json -Compress -InputObject @{ texts = @($items) })
`;

/** 明显是密钥/令牌形态的字符串不进摘录（密码框 UIA 本身不回传明文，这里再兜一层）。 */
const SECRETISH = [/sk-[A-Za-z0-9_\-.]{16,}/, /^(?:[A-Za-z0-9+/=_-]{32,})$/];

/** 清洗 UIA 原始条目：去空白、限长、去重、剔除疑似密钥。纯函数，可单测。 */
function filterUiTexts(list, { maxItems = 30, maxLen = 80 } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (s.length < 2 || s.length > maxLen) continue;
    if (SECRETISH.some((re) => re.test(s))) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * 每个进程的超时与负缓存策略（纯函数对象，可单测）：
 * - 本会话首次见到某个进程 → 给 firstMs，容忍 Chromium 系冷启动；
 * - 上一次是「超时」→ 下次仍给 firstMs（此时它多半已热）；上次是「快速返回空」→ 用 fastMs；
 * - 失败/空结果进入 negativeMs 负缓存，期间直接跳过，避免每轮都卡。
 */
function createUiTextPolicy({ negativeMs = 30 * 60 * 1000, firstMs = 5000, fastMs = 1400 } = {}) {
  const state = new Map(); // process -> { until, timedOut }
  const keyOf = (p) => String(p || '').toLowerCase();
  return {
    skip(process, now = Date.now()) {
      const key = keyOf(process);
      if (!key) return true;
      const st = state.get(key);
      return !!(st && st.until > now);
    },
    timeoutFor(process) {
      const st = state.get(keyOf(process));
      if (!st) return firstMs;
      return st.timedOut ? firstMs : fastMs;
    },
    record(process, { ok = false, timedOut = false, now = Date.now() } = {}) {
      const key = keyOf(process);
      if (!key) return;
      // 成功：保留「已见过」标记（until=0 不拦截），后续用快超时；
      // 失败/空结果：进入负缓存，期间 skip() 直接放行 []。
      if (ok) state.set(key, { until: 0, timedOut: false });
      else state.set(key, { until: now + negativeMs, timedOut: !!timedOut });
    }
  };
}

module.exports = { UI_TEXT_PS1, filterUiTexts, createUiTextPolicy };

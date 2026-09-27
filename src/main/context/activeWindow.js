const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { DATA_ROOT } = require('../paths');

/**
 * 读取前台窗口标题与进程名（仅本机只读，不外发）。
 * 优先 PowerShell 7（pwsh），回退 Windows PowerShell 5.1。
 * 脚本会在首次使用时落地到 data/scripts/ 内，保持「only one 文件夹」。
 */
const PS1 = String.raw`$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WhalePalWin32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$hwnd = [WhalePalWin32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { Write-Output '{}'; exit 0 }
$sb = New-Object System.Text.StringBuilder 512
[void][WhalePalWin32]::GetWindowTextW($hwnd, $sb, 512)
$title = $sb.ToString()
$pidValue = [uint32]0
[void][WhalePalWin32]::GetWindowThreadProcessId($hwnd, [ref]$pidValue)
$procName = ''
if ($pidValue -ne 0) {
  $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($proc) { $procName = $proc.ProcessName }
}
$result = [ordered]@{ title = $title; process = $procName; pid = [int]$pidValue }
Write-Output ($result | ConvertTo-Json -Compress)
`;

function ensureScript() {
  const dir = path.join(DATA_ROOT, 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'active-window.ps1');
  // 始终重写：脚本内容随版本更新，避免旧副本导致行为不一致
  fs.writeFileSync(file, PS1, 'utf8');
  return file;
}

function runWith(command, file, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    );
  });
}

async function getActiveWindow({ timeoutMs = 5000 } = {}) {
  const file = ensureScript();
  for (const command of ['pwsh.exe', 'pwsh', 'powershell.exe']) {
    try {
      const stdout = await runWith(command, file, timeoutMs);
      const parsed = JSON.parse(String(stdout).trim() || '{}');
      return {
        title: String(parsed.title || ''),
        process: String(parsed.process || ''),
        pid: Number(parsed.pid || 0)
      };
    } catch {
      // 尝试下一个命令（ENOENT / 超时 / 解析失败都走这里）
    }
  }
  return { title: '', process: '', pid: 0, error: 'powershell-unavailable' };
}

module.exports = { getActiveWindow };

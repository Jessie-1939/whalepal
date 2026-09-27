# 读取当前前台窗口的标题与进程名，供无 AI 时的本地上下文分析使用。
# 无任何外部请求，只读本机窗口信息。
$ErrorActionPreference = 'SilentlyContinue'

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
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);
}
"@

$hwnd = [WhalePalWin32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output '{}'
  exit 0
}

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

$result = [ordered]@{
  title = $title
  process = $procName
  pid = [int]$pidValue
}
Write-Output ($result | ConvertTo-Json -Compress)

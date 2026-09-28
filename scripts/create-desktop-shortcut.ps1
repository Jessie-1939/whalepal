# 在桌面创建「鲸伴 WhalePal」快捷方式（默认用 启动鲸伴.vbs 作为入口，无命令行窗口）
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $root '启动鲸伴.vbs'
if (-not (Test-Path $entry)) {
  throw "找不到启动器：$entry"
}

# 图标：优先用生成的 whale.ico，没有就用仓库里的 logo.png 现做一个（PNG 负载 ICO）
$ico = Join-Path $root 'build\icons\whale.ico'
$logo = Join-Path $root 'src\renderer\pet\assets\logo.png'
if (-not (Test-Path $ico) -and (Test-Path $logo)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $ico) | Out-Null
  $png = [System.IO.File]::ReadAllBytes($logo)
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)          # ICONDIR
  $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0) # 256x256
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)                              # planes / bpp
  $bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22)                    # size / offset
  $bw.Write($png); $bw.Flush()
  [System.IO.File]::WriteAllBytes($ico, $ms.ToArray())
  $bw.Dispose(); $ms.Dispose()
  Write-Output "已生成图标：$ico"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '鲸伴 WhalePal.lnk'
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($lnkPath)
$sc.TargetPath = 'wscript.exe'
$sc.Arguments = '"' + $entry + '"'
$sc.WorkingDirectory = $root
$sc.Description = '启动桌面 AI 伙伴：鲸伴 WhalePal'
if (Test-Path $ico) { $sc.IconLocation = "$ico,0" }
$sc.Save()

Write-Output "桌面快捷方式已创建：$lnkPath"

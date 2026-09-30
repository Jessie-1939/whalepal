# 把 Windows 本机信任的根证书导出成 PEM，供 Node/Electron 使用。
#
# 为什么需要：装了杀毒软件（Kaspersky / ESET / 360 等）或公司代理的机器上，
# 这些软件会重签 HTTPS 证书（中间人）。Windows 自己信任它，但 Node/Electron 用的是
# 内置 CA 清单，不认识这张根证书 —— 结果所有云端调用都报
# "self signed certificate in certificate chain"。
#
# 这个脚本只做一件事：把系统信任库里的根证书导出到 <项目>/data/tls/windows-roots.pem。
# 之后用 NODE_EXTRA_CA_CERTS 指向它启动，Node/Electron 就与系统信任保持一致。
# 不联网、不改系统设置、不安装任何证书。
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'data\tls'
$outFile = Join-Path $outDir 'windows-roots.pem'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$pems = New-Object System.Collections.Generic.List[string]
foreach ($store in @('Cert:\LocalMachine\Root', 'Cert:\CurrentUser\Root')) {
  Get-ChildItem $store -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $b64 = [Convert]::ToBase64String($_.RawData, [Base64FormattingOptions]::InsertLineBreaks)
      $pems.Add("# $($_.Subject)`n-----BEGIN CERTIFICATE-----`n$b64`n-----END CERTIFICATE-----")
    } catch {
      # 极少数证书拿不到 RawData，跳过
    }
  }
}

if ($pems.Count -eq 0) {
  Write-Error '没有从系统信任库读到任何根证书'
  exit 1
}

Set-Content -LiteralPath $outFile -Value ($pems -join "`n") -Encoding ascii
Write-Host "已导出 $($pems.Count) 张系统根证书 → $outFile"

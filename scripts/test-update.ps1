# 更新链路自测：用本地假 feed 模拟「v1.1.1 发布 → 客户端自动升级」
# 用法：pwsh -File scripts\test-update.ps1
# 说明：把程序复制到临时目录再升级，不会动到 build\ 里的正式产物。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$srcApp = Join-Path $root 'build\DesktopClock-win32-x64'
$work = Join-Path $env:TEMP 'clock-updtest'
$runApp = Join-Path $work 'run\DesktopClock-win32-x64'
$runRoot = Join-Path $work 'run'
$data = Join-Path $work 'userdata'
$web = Join-Path $work 'web'
$newPkg = Join-Path $work 'new-version'
$port = 8791
$appLog = Join-Path $work 'app.log'
$updateLog = Join-Path $env:TEMP 'desktop-clock-update\update.log'

if (-not (Test-Path $srcApp)) { throw "缺少打包产物，请先运行 npm run dist" }

Write-Host "== 1. 准备测试目录 ==" -ForegroundColor Cyan
Get-Process DesktopClock -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 600
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:TEMP 'desktop-clock-update') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:TEMP 'clock-autotest-done') -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $runRoot, $data, $web, $newPkg | Out-Null

# 正在运行的旧版本（不含标记文件）
Copy-Item $srcApp $runApp -Recurse
# “新版本”单独一份，带标记文件，只用来打 zip
Copy-Item "$srcApp\*" $newPkg -Recurse
Set-Content -Path (Join-Path $newPkg 'UPDATED-MARKER.txt') -Value 'only in the fake new version' -Encoding utf8

@'
{
  "time": { "timeZone": "Asia/Shanghai" },
  "look": { "panelOpacity": 0.37, "fontWeight": 600 },
  "instances": [
    { "id": "main", "name": "主时钟", "displayId": "auto", "preset": null },
    { "id": "second", "name": "副屏", "displayId": "auto", "preset": "minimal" }
  ]
}
'@ | Set-Content -Encoding utf8 (Join-Path $data 'config.json')
@{ main = @{ x = 321; y = 123; width = 300; height = 150 }; second = @{ x = 640; y = 400; width = 260; height = 120 } } |
  ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $data 'layout.json')

Write-Host "== 2. 打包假的新版本 ==" -ForegroundColor Cyan
$zip = Join-Path $web 'app.zip'
Compress-Archive -Path "$newPkg\*" -DestinationPath $zip -CompressionLevel Optimal
$size = (Get-Item $zip).Length
$zipUrl = "http://127.0.0.1:$port/app.zip"
@{ tag_name = 'v1.1.1'; body = "## 本地测试发布`n- 这是一次模拟升级"; published_at = '2026-11-13T08:00:00Z'
   assets = @(@{ name = 'DesktopClock-win32-x64.zip'; size = $size; browser_download_url = $zipUrl }) } |
  ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $web 'latest.json')
Write-Host "   zip: $([math]::Round($size/1mb,1)) MB"

Write-Host "== 3. 启动本地服务 + 运行旧版本 ==" -ForegroundColor Cyan
$python = 'C:\Users\admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }
$server = Start-Process -FilePath $python -ArgumentList '-m','http.server',$port,'--bind','127.0.0.1','--directory',$web -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $work 'server.out') -RedirectStandardError (Join-Path $work 'server.err')
Start-Sleep -Seconds 2

$env:CLOCK_UPDATE_FEED = "http://127.0.0.1:$port/latest.json"
$env:CLOCK_AUTOTEST_UPDATE = '1'
$env:CLOCK_LOG = $appLog
$env:ELECTRON_RUN_AS_NODE = $null
$startedAt = Get-Date
$oldApp = Start-Process -FilePath (Join-Path $runApp 'DesktopClock.exe') -ArgumentList '--no-sandbox', "--user-data-dir=$data" -PassThru -WorkingDirectory $runApp

Write-Host "== 4. 等待「检查 → 下载 → 触发安装」 ==" -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(180)
$applied = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  if (Test-Path $appLog) {
    $content = Get-Content $appLog -Raw -ErrorAction SilentlyContinue
    if ($content -match 'autotest: apply \{"ok":true\}') { $applied = $true; break }
    if ($content -match 'autotest: failed|autotest: check error|autotest: download error') { break }
  }
}
Write-Host "   触发安装: $applied"

Write-Host "== 5. 等待替换文件并重启 ==" -ForegroundColor Cyan
$marker = Join-Path $runApp 'UPDATED-MARKER.txt'
$replaced = $false
$restarted = $false
$scriptDone = $false
$deadline = (Get-Date).AddSeconds(240)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  if (Test-Path $updateLog) {
    $t = Get-Content $updateLog -Raw -ErrorAction SilentlyContinue
    if ($t -match 'done') { $scriptDone = $true }
    if ($t -match 'FAILED') { break }
  }
  if ($scriptDone -and (Test-Path $marker)) {
    $replaced = $true
    $procs = Get-Process DesktopClock -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $oldApp.Id }
    if ($procs) { $restarted = $true; break }
  }
}

Write-Host "== 6. 校验结果 ==" -ForegroundColor Cyan
$cfg = Get-Content (Join-Path $data 'config.json') -Raw | ConvertFrom-Json
$lay = Get-Content (Join-Path $data 'layout.json') -Raw | ConvertFrom-Json
$backup = Get-ChildItem $runRoot -Directory -Filter 'DesktopClock-backup-*' -ErrorAction SilentlyContinue
$updLog = if (Test-Path $updateLog) { Get-Content $updateLog -Raw } else { '' }
$checks = [ordered]@{
  '检查到新版本并触发安装'          = $applied
  '更新包已解压覆盖（标记文件存在）' = $replaced
  '更新后程序已重新启动'            = [bool]$restarted
  '更新脚本执行成功（日志 done）'   = ($updLog -match 'done' -and $updLog -notmatch 'FAILED')
  '备份目录已生成'                  = [bool]$backup
  '时区设置保留（Asia/Shanghai）'   = ($cfg.time.timeZone -eq 'Asia/Shanghai')
  '外观设置保留（0.37 / 600）'      = ($cfg.look.panelOpacity -eq 0.37 -and $cfg.look.fontWeight -eq 600)
  '时钟实例保留（2 个）'            = ($cfg.instances.Count -eq 2)
  '窗口位置保留（321,123）'         = ($lay.main.x -eq 321 -and $lay.main.y -eq 123)
}
$failed = $false
foreach ($k in $checks.Keys) {
  $ok = $checks[$k]
  if (-not $ok) { $failed = $true }
  Write-Host ("  [{0}] {1}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $k) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
}

Write-Host "== 7. 清理 ==" -ForegroundColor Cyan
Get-Process DesktopClock -ErrorAction SilentlyContinue | Stop-Process -Force
if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
Remove-Item (Join-Path $env:TEMP 'clock-autotest-done') -Force -ErrorAction SilentlyContinue
if ($failed) {
  Write-Host "存在失败项，保留目录供排查：$work" -ForegroundColor Yellow
  Write-Host "  应用日志: $appLog"
  Write-Host "  更新日志: $updateLog"
  exit 1
}
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:TEMP 'desktop-clock-update') -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "全部通过 ✅" -ForegroundColor Green




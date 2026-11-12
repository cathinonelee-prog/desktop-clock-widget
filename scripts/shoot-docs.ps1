# 在干净背景（docs\backdrop.png）下生成 README 截图，不含任何桌面文件
# 用法：pwsh -File scripts\shoot-docs.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root '.test-data'
$shots = Join-Path $root '.shots'
$docs = Join-Path $root 'docs'
$exe = Join-Path $root 'build\DesktopClock-win32-x64\DesktopClock.exe'
$backdropPath = Join-Path $docs 'backdrop.png'

New-Item -ItemType Directory -Force -Path $dataDir, $shots | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Win -Name Kbd -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
'@

function ShowDesktop {
  [Win.Kbd]::keybd_event(0x5B, 0, 0, 0)
  [Win.Kbd]::keybd_event(0x44, 0, 0, 0)
  [Win.Kbd]::keybd_event(0x44, 0, 2, 0)
  [Win.Kbd]::keybd_event(0x5B, 0, 2, 0)
  Start-Sleep -Milliseconds 800
}

# 用干净壁纸铺一块背景窗口，再让时钟浮在上面，最后截取指定区域
function ShootWithBackdrop {
  param(
    [hashtable]$Config,
    [hashtable]$Layout,
    [int]$X, [int]$Y, [int]$W, [int]$H,
    [string]$OutPath
  )

  Get-Process DesktopClock, electron -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 500
  ShowDesktop

  $form = New-Object System.Windows.Forms.Form
  $form.FormBorderStyle = 'None'
  $form.StartPosition = 'Manual'
  $form.Bounds = New-Object System.Drawing.Rectangle(0, 0, 1600, 900)
  $form.BackgroundImage = [System.Drawing.Image]::FromFile($backdropPath)
  $form.BackgroundImageLayout = 'Stretch'
  $form.TopMost = $true
  $form.Show()
  $form.Activate()
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 600

  $Config | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $dataDir 'config.json')
  $Layout | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $dataDir 'layout.json')

  $env:ELECTRON_RUN_AS_NODE = $null
  Start-Process -FilePath $exe -ArgumentList '--no-sandbox', "--user-data-dir=$dataDir" -PassThru `
    -RedirectStandardOutput (Join-Path $dataDir 'out.txt') `
    -RedirectStandardError (Join-Path $dataDir 'err.txt') | Out-Null
  Start-Sleep -Seconds 6

  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size)
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()

  Get-Process DesktopClock, electron -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 400
  $form.Close()
  $form.Dispose()
  Start-Sleep -Milliseconds 300
}

try {
  # 1) 主图：单个“完整信息”时钟
  ShootWithBackdrop -Config @{
    content   = @{ preset = 'full' }
    look      = @{ theme = 'dark'; accent = '#5eead4'; panelOpacity = 0.46 }
    instances = @(@{ id = 'main'; name = '主时钟'; displayId = 'auto'; preset = $null })
  } -Layout @{ main = @{ x = 640; y = 330; width = 300; height = 160 } } `
    -X 500 -Y 260 -W 700 -H 360 -OutPath (Join-Path $shots 'hero-full.png')

  # 2) 版式预览：三种版式并排
  ShootWithBackdrop -Config @{
    content   = @{ preset = 'full' }
    look      = @{ theme = 'dark'; accent = '#5eead4'; panelOpacity = 0.46 }
    instances = @(
      @{ id = 'a'; name = '时间·日期'; displayId = 'auto'; preset = 'standard' }
      @{ id = 'b'; name = '农历详情'; displayId = 'auto'; preset = 'lunar' }
      @{ id = 'c'; name = '单行紧凑'; displayId = 'auto'; preset = 'single' }
    )
  } -Layout @{
    a = @{ x = 130; y = 330; width = 320; height = 150 }
    b = @{ x = 560; y = 330; width = 320; height = 190 }
    c = @{ x = 900; y = 360; width = 460; height = 120 }
  } -X 90 -Y 280 -W 1360 -H 300 -OutPath (Join-Path $shots 'presets.png')

  # 3) 浅色主题（README 可选展示）
  ShootWithBackdrop -Config @{
    content   = @{ preset = 'full' }
    look      = @{ theme = 'light'; accent = '#0ea5a4'; panelOpacity = 0.72 }
    instances = @(@{ id = 'main'; name = '浅色'; displayId = 'auto'; preset = $null })
  } -Layout @{ main = @{ x = 640; y = 330; width = 300; height = 160 } } `
    -X 560 -Y 300 -W 580 -H 280 -OutPath (Join-Path $shots 'hero-light.png')
}
finally {
  Get-Process DesktopClock, electron -ErrorAction SilentlyContinue | Stop-Process -Force
  ShowDesktop
}

Copy-Item (Join-Path $shots 'hero-full.png') (Join-Path $docs 'preview-widget.png') -Force
Copy-Item (Join-Path $shots 'presets.png') (Join-Path $docs 'preview-presets.png') -Force
Copy-Item (Join-Path $shots 'hero-light.png') (Join-Path $docs 'preview-light.png') -Force
"截图已更新：docs\preview-widget.png, docs\preview-presets.png, docs\preview-light.png"

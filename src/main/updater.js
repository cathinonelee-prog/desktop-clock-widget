'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DEFAULT_FEED = 'https://api.github.com/repos/cathinonelee-prog/desktop-clock-widget/releases/latest';
const OWNER_REPO = { owner: 'cathinonelee-prog', repo: 'desktop-clock-widget' };

function parseVersion(value) {
  const text = String(value || '').trim().replace(/^v/i, '');
  const [main] = text.split(/[-+]/);
  return main.split('.').map((n) => Number.parseInt(n, 10) || 0);
}

/** 返回 true 表示 a 比 b 新 */
function isNewer(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i += 1) {
    const x = va[i] || 0;
    const y = vb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function xmlEscape(text) {
  return String(text).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}

class Updater extends EventEmitter {
  constructor({ app, currentVersion, config }) {
    super();
    this.app = app;
    this.currentVersion = currentVersion;
    this.config = config;
    this.status = 'idle';
    this.latestVersion = null;
    this.notes = '';
    this.publishedAt = null;
    this.assetName = null;
    this.assetSize = 0;
    this.assetUrl = null;
    this.received = 0;
    this.error = null;
    this.checkedAt = null;
    this.tempDir = path.join(os.tmpdir(), 'desktop-clock-update');
    this.zipPath = path.join(this.tempDir, 'update.zip');
    this.busy = false;
  }

  state() {
    return {
      currentVersion: this.currentVersion,
      status: this.status,
      latestVersion: this.latestVersion,
      notes: this.notes,
      publishedAt: this.publishedAt,
      assetName: this.assetName,
      assetSize: this.assetSize,
      received: this.received,
      progress: this.assetSize ? Math.min(100, Math.round((this.received / this.assetSize) * 100)) : 0,
      error: this.error,
      checkedAt: this.checkedAt,
      autoCheck: Boolean(this.config.get().update?.autoCheck),
      feed: this.feed(),
    };
  }

  feed() {
    return process.env.CLOCK_UPDATE_FEED || this.config.get().update?.feed || DEFAULT_FEED;
  }

  #emit() {
    this.emit('state', this.state());
  }

  /** 检查是否有新版本；force=false 时 10 分钟内不重复请求 */
  async check({ force = false } = {}) {
    if (this.busy) return this.state();
    if (!force && this.checkedAt && Date.now() - this.checkedAt < 10 * 60 * 1000) return this.state();

    this.busy = true;
    this.status = 'checking';
    this.error = null;
    this.#emit();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(this.feed(), {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `DesktopClock/${this.currentVersion}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const tag = data.tag_name || data.tag || data.version || '';
      if (!tag) throw new Error('响应里没有版本号');

      const assets = Array.isArray(data.assets) ? data.assets : Array.isArray(data.files) ? data.files : [];
      const asset = assets.find((a) => /\.zip$/i.test(a.name || '')) || null;

      this.latestVersion = String(tag).replace(/^v/i, '');
      this.notes = String(data.body || data.notes || '');
      this.publishedAt = data.published_at || data.publishedAt || null;
      this.checkedAt = Date.now();
      this.assetName = asset?.name || null;
      this.assetSize = Number(asset?.size || data.size || 0);
      this.assetUrl = asset?.browser_download_url || asset?.url || data.download_url || data.url || null;
      this.received = 0;

      this.status = isNewer(this.latestVersion, this.currentVersion) ? 'available' : 'latest';
      if (this.status === 'available' && !this.assetUrl) {
        this.status = 'error';
        this.error = '没有找到可下载的更新包';
      }
    } catch (err) {
      this.status = 'error';
      this.error = err.name === 'AbortError' ? '检查更新超时' : err.message;
    } finally {
      this.busy = false;
      this.#emit();
    }
    return this.state();
  }

  /** 下载更新包到临时目录，带进度回调 */
  async download() {
    if (this.busy) return this.state();
    if (this.status !== 'available' || !this.assetUrl) return this.state();

    this.busy = true;
    this.status = 'downloading';
    this.received = 0;
    this.error = null;
    this.#emit();

    try {
      await fsp.mkdir(this.tempDir, { recursive: true });
      await fsp.rm(this.zipPath, { force: true });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
      const res = await fetch(this.assetUrl, {
        redirect: 'follow',
        headers: { 'user-agent': `DesktopClock/${this.currentVersion}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);

      const declared = Number(res.headers.get('content-length') || 0);
      if (declared) this.assetSize = declared;

      let lastEmit = 0;
      const counter = new (require('node:stream').Transform)({
        transform: (chunk, _enc, cb) => {
          this.received += chunk.length;
          const now = Date.now();
          if (now - lastEmit > 150) {
            lastEmit = now;
            this.#emit();
          }
          cb(null, chunk);
        },
      });

      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(this.zipPath));
      clearTimeout(timer);

      const stat = await fsp.stat(this.zipPath);
      if (stat.size < 1024) throw new Error('下载的更新包不完整');
      if (this.assetSize && Math.abs(stat.size - this.assetSize) > 1024) {
        throw new Error(`更新包大小不一致（${stat.size} / ${this.assetSize}）`);
      }

      this.assetSize = stat.size;
      this.received = stat.size;
      this.status = 'ready';
    } catch (err) {
      this.status = 'error';
      this.error = err.name === 'AbortError' ? '下载超时' : err.message;
      await fsp.rm(this.zipPath, { force: true }).catch(() => {});
    } finally {
      this.busy = false;
      this.#emit();
    }
    return this.state();
  }

  /** 生成更新脚本并启动（脚本会等本进程退出后替换文件并重启） */
  async apply() {
    if (this.status !== 'ready') return { ok: false, error: '更新包尚未下载完成' };
    if (!fs.existsSync(this.zipPath)) return { ok: false, error: '更新包已丢失，请重新下载' };

    const targetDir = path.dirname(this.app.getPath('exe'));
    const exeName = path.basename(this.app.getPath('exe'));
    const scriptPath = path.join(this.tempDir, 'apply-update.ps1');
    const launcherPath = path.join(this.tempDir, 'launch-update.vbs');
    const logPath = path.join(this.tempDir, 'update.log');

    try {
      await fsp.mkdir(this.tempDir, { recursive: true });
      await fsp.writeFile(scriptPath, this.#script(), 'utf8');
      // VBS 用 UTF-16LE + BOM 保存，Windows Script Host 才能正确读取非 ASCII 路径
      const vbs = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(this.#launcher(scriptPath, targetDir, exeName, logPath), 'utf16le')]);
      await fsp.writeFile(launcherPath, vbs);
    } catch (err) {
      return { ok: false, error: `无法写入更新脚本：${err.message}` };
    }

    // 检查目标目录是否可写（便携版放在 Program Files 里会失败）
    try {
      const probe = path.join(targetDir, `.clock-write-test-${Date.now()}`);
      await fsp.writeFile(probe, 'ok');
      await fsp.rm(probe, { force: true });
    } catch {
      return { ok: false, error: '程序目录不可写，请把程序放到有写权限的目录，或手动下载更新包' };
    }

    // 通过 explorer 启动 launcher：
    // 直接 spawn 的子进程会随本进程退出被同一 Job Object 结束，绕一层 explorer 才能真正脱离
    try {
      const child = spawn('explorer.exe', [launcherPath], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      this.status = 'applying';
      this.#emit();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `启动更新脚本失败：${err.message}` };
    }
  }

  #launcher(scriptPath, targetDir, exeName, logPath) {
    const arg = (value) => `"${String(value)}"`;
    const command =
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ${arg(scriptPath)}` +
      ` -AppPid ${process.pid} -Zip ${arg(this.zipPath)} -Target ${arg(targetDir)}` +
      ` -Exe ${arg(exeName)} -Log ${arg(logPath)}`;
    // VBS 字符串里，内部的 " 需要写成 ""
    const escaped = command.replace(/"/g, '""');
    return `' Desktop Clock updater launcher (generated)
Set shell = CreateObject("WScript.Shell")
shell.Run "${escaped}", 0, False
`;
  }

  #script() {
    return `# 悬浮时钟自动更新脚本（由程序生成，升级完成后可删除）
param(
  [Parameter(Mandatory=$true)][int]$AppPid,
  [Parameter(Mandatory=$true)][string]$Zip,
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][string]$Exe,
  [Parameter(Mandatory=$true)][string]$Log
)

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message) {
  try { Add-Content -LiteralPath $Log -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message) } catch {}
}

$backup = $null
$staging = $null

try {
  Write-Log "waiting for process $AppPid"
  try { Wait-Process -Id $AppPid -Timeout 90 -ErrorAction Stop } catch { Write-Log "process already exited" }
  Start-Sleep -Milliseconds 900

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $parent = Split-Path -Parent $Target
  $backup = Join-Path $parent ("DesktopClock-backup-" + $stamp)
  $staging = Join-Path $env:TEMP ("clock-update-" + $stamp)

  Write-Log "backup -> $backup"
  Copy-Item -LiteralPath $Target -Destination $backup -Recurse -Force

  Write-Log "extract -> $staging"
  Expand-Archive -LiteralPath $Zip -DestinationPath $staging -Force

  Write-Log "apply -> $Target"
  robocopy $staging $Target /MIR /NFL /NDL /NJH /NJS /R:2 /W:2 | Out-Null
  $code = $LASTEXITCODE
  if ($code -ge 8) { throw "robocopy failed with code $code" }

  $exePath = Join-Path $Target $Exe
  Write-Log "start app -> $exePath (exists=$(Test-Path -LiteralPath $exePath))"

  # 刚被覆盖的 exe 可能被杀软/索引短暂占用，重试几次再判定失败
  $started = $false
  for ($i = 0; $i -lt 6 -and -not $started; $i++) {
    if (Test-Path -LiteralPath $exePath) {
      try {
        Start-Process -FilePath $exePath -WorkingDirectory $Target -ErrorAction Stop
        $started = $true
      } catch {
        Write-Log ("start retry {0}: {1}" -f $i, $_.Exception.Message)
        Start-Sleep -Seconds 2
      }
    } else {
      Write-Log ("exe not found, retry {0}" -f $i)
      Start-Sleep -Seconds 2
    }
  }
  if (-not $started) { throw "could not start updated app" }

  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue

  # 只保留最近一份备份
  Get-ChildItem $parent -Directory -Filter 'DesktopClock-backup-*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -Skip 1 |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

  Write-Log "done"
  exit 0
}
catch {
  Write-Log ("FAILED: " + $_.Exception.Message)
  if ($backup -and (Test-Path -LiteralPath $backup)) {
    Write-Log "rollback -> $Target"
    robocopy $backup $Target /MIR /NFL /NDL /NJH /NJS /R:2 /W:2 | Out-Null
  }
  $exePath = Join-Path $Target $Exe
  if (Test-Path -LiteralPath $exePath) {
    try { Start-Process -FilePath $exePath -WorkingDirectory $Target -ErrorAction Stop } catch { Write-Log ("restart after rollback failed: " + $_.Exception.Message) }
  }
  exit 1
}
`;
  }
}

module.exports = { Updater, DEFAULT_FEED, OWNER_REPO, parseVersion, isNewer };

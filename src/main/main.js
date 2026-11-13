'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  screen,
  nativeImage,
  globalShortcut,
  shell,
  protocol,
} = require('electron');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { ConfigStore } = require('./config');
const { ClockService } = require('./clock');
const { WindowManager } = require('./windows');
const { Updater } = require('./updater');
const { registerAppProtocol, createSettingsWindow } = require('./shell');

const ROOT = path.resolve(__dirname, '..', '..');

// 可选的文件日志（GUI 进程默认没有控制台输出）
const LOG_FILE = process.env.CLOCK_LOG || null;
const log = (msg) => {
  if (!LOG_FILE) return;
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* 忽略 */
  }
};
process.on('uncaughtException', (err) => log(`uncaught: ${err?.stack || err}`));
process.on('unhandledRejection', (err) => log(`unhandled: ${err?.stack || err}`));
log(`boot argv=${process.argv.join(' ')}`);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const args = process.argv.slice(1);
const argValue = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const CAPTURE_DIR = argValue('capture');

// 用户数据放在纯 ASCII 目录（默认名字是中文，个别环境会出问题）；
// 命令行显式指定 --user-data-dir 时尊重传入值（便于测试与便携使用）
try {
  if (!args.some((a) => a.startsWith('--user-data-dir'))) {
    app.setPath('userData', path.join(app.getPath('appData'), 'desktop-clock-widget'));
  }
} catch (err) {
  console.error('[app] setPath failed', err);
}

let tray = null;
let settingsWin = null;
let windowManager = null;
let clock = null;
let config = null;
let quitting = false;
let updater = null;
let updateTimer = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (windowManager) windowManager.showAll();
    openSettings();
  });
}

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// 低内存模式：在窗口/GPU 初始化之前读取配置，决定是否关闭 GPU 加速
try {
  const earlyConfig = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'));
  if (earlyConfig?.behavior?.lowMemory === true) {
    app.commandLine.appendSwitch('disable-gpu');
    log('low-memory mode: GPU disabled');
  }
} catch {
  /* 首次运行没有配置文件，忽略 */
}

function applyAutostart(enabled) {
  try {
    const args = app.isPackaged ? [] : [ROOT];
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
      args,
    });
  } catch (err) {
    console.error('[autostart] failed', err);
  }
}

function displayList() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: `屏幕 ${i + 1}${d.id === primaryId ? '（主屏）' : ''} · ${d.size.width}×${d.size.height}`,
    primary: d.id === primaryId,
    bounds: d.bounds,
    workArea: d.workArea,
    scaleFactor: d.scaleFactor,
  }));
}

function pushConfig() {
  const payload = { config: config.get(), layout: windowManager.layoutSnapshot(), displays: displayList() };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('config:changed', payload);
  }
}

function updateInstance(id, patch) {
  const cfg = config.get();
  const instances = cfg.instances.map((inst) => (inst.id === id ? { ...inst, ...patch } : inst));
  config.update({ instances });
}

function addInstance(displayId = 'auto') {
  const cfg = config.get();
  const used = new Set(cfg.instances.map((i) => i.id));
  let n = cfg.instances.length + 1;
  let id = `screen-${n}`;
  while (used.has(id)) {
    n += 1;
    id = `screen-${n}`;
  }
  const instances = [
    ...cfg.instances,
    { id, name: `时钟 ${n}`, displayId, preset: null, bounds: null, hidden: false },
  ];
  config.update({ instances });
  return id;
}

function removeInstance(id) {
  const cfg = config.get();
  if (cfg.instances.length <= 1) return false;
  config.update({ instances: cfg.instances.filter((i) => i.id !== id) });
  return true;
}

function createOnePerDisplay() {
  const displays = displayList();
  const existing = config.get().instances;
  const instances = displays.map((d, i) => {
    const prev = existing[i];
    return {
      id: prev?.id || `screen-${i + 1}`,
      name: prev?.name || `时钟 ${i + 1}`,
      displayId: d.id,
      preset: prev?.preset ?? null,
      bounds: null,
      hidden: false,
    };
  });
  config.update({ instances });
}

function buildWidgetMenu(instanceId) {
  const cfg = config.get();
  const inst = cfg.instances.find((i) => i.id === instanceId);
  const presetLabels = {
    minimal: '极简时间',
    standard: '时间 + 日期',
    full: '完整信息',
    lunar: '农历详情',
    single: '单行紧凑',
  };
  return Menu.buildFromTemplate([
    {
      label: '显示模式',
      submenu: [
        {
          label: '跟随全局设置',
          type: 'radio',
          checked: !inst?.preset,
          click: () => updateInstance(instanceId, { preset: null }),
        },
        { type: 'separator' },
        ...Object.entries(presetLabels).map(([id, label]) => ({
          label,
          type: 'radio',
          checked: inst?.preset === id,
          click: () => updateInstance(instanceId, { preset: id }),
        })),
      ],
    },
    { type: 'separator' },
    {
      label: '始终置顶',
      type: 'radio',
      checked: cfg.window.layer === 'alwaysOnTop',
      click: () => config.update({ window: { layer: 'alwaysOnTop' } }),
    },
    {
      label: '固定在桌面层',
      type: 'radio',
      checked: cfg.window.layer === 'desktop',
      click: () => config.update({ window: { layer: 'desktop' } }),
    },
    { type: 'separator' },
    {
      label: '锁定位置',
      type: 'checkbox',
      checked: cfg.window.locked,
      click: () => config.update({ window: { locked: !cfg.window.locked } }),
    },
    {
      label: '鼠标点击穿透',
      type: 'checkbox',
      checked: cfg.window.clickThrough,
      click: () => config.update({ window: { clickThrough: !cfg.window.clickThrough } }),
    },
    { type: 'separator' },
    { label: '隐藏这个时钟', click: () => updateInstance(instanceId, { hidden: true }) },
    { label: '立即对齐网络时间', click: () => clock.sync() },
    { label: '设置…', click: () => openSettings() },
    { type: 'separator' },
    { label: '退出悬浮时钟', click: () => quitApp() },
  ]);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const cfg = config.get();
  const presetLabels = {
    minimal: '极简时间',
    standard: '时间 + 日期',
    full: '完整信息',
    lunar: '农历详情',
    single: '单行紧凑',
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: windowManager?.hiddenAll ? '显示所有时钟' : '隐藏所有时钟', click: () => windowManager?.toggleAll() },
      { label: `添加时钟窗口（共 ${cfg.instances.length} 个）`, click: () => addInstance('auto') },
      { type: 'separator' },
      {
        label: '显示模式',
        submenu: Object.entries(presetLabels).map(([id, label]) => ({
          label,
          type: 'radio',
          checked: cfg.content.preset === id,
          click: () => config.update({ content: { preset: id } }),
        })),
      },
      {
        label: '窗口层级',
        submenu: [
          {
            label: '始终置顶',
            type: 'radio',
            checked: cfg.window.layer === 'alwaysOnTop',
            click: () => config.update({ window: { layer: 'alwaysOnTop' } }),
          },
          {
            label: '固定在桌面层',
            type: 'radio',
            checked: cfg.window.layer === 'desktop',
            click: () => config.update({ window: { layer: 'desktop' } }),
          },
        ],
      },
      { type: 'separator' },
      { label: '立即同步网络时间', click: () => clock.sync() },
      { label: '时间源：' + (cfg.clock.source === 'ntp' ? '网络授时' : '本机系统时间'), enabled: false },
      { type: 'separator' },
      {
        label: '开机自启',
        type: 'checkbox',
        checked: cfg.behavior.autostart,
        click: () => config.update({ behavior: { autostart: !cfg.behavior.autostart } }),
      },
      { label: '设置…', click: () => openSettings() },
      { type: 'separator' },
      { label: '退出', click: () => quitApp() },
    ]),
  );
}

function createTray() {
  const iconPath = path.join(ROOT, 'resources', 'tray.png');
  let image = nativeImage.createEmpty();
  if (fs.existsSync(iconPath)) {
    image = nativeImage.createFromPath(iconPath);
    if (process.platform === 'win32') image = image.resize({ width: 16, height: 16 });
  }
  tray = new Tray(image);
  log(`tray icon empty=${image.isEmpty()} size=${JSON.stringify(image.getSize())}`);
  tray.setToolTip('悬浮时钟');
  rebuildTrayMenu();
  tray.on('double-click', () => openSettings());
  tray.on('click', () => openSettings());
}

function openSettings(tab) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    if (tab) settingsWin.webContents.send('settings:tab', tab);
    return;
  }
  try {
    settingsWin = createSettingsWindow({ rootDir: ROOT, tab });
    log('settings window created');
    settingsWin.webContents.on('did-fail-load', (_e, code, desc, url) => log(`[settings] load failed ${code} ${desc} ${url}`));
    settingsWin.webContents.on('console-message', (event) => log(`[settings] ${event.message} (${event.sourceId}:${event.lineNumber})`));
    settingsWin.once('ready-to-show', () => log('settings ready-to-show'));
    settingsWin.on('closed', () => {
      settingsWin = null;
      log('settings closed');
    });
  } catch (err) {
    log(`[settings] create failed ${err?.stack || err}`);
  }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const cfg = config.get();
  try {
    if (cfg.hotkeys.toggle) globalShortcut.register(cfg.hotkeys.toggle, () => windowManager?.toggleAll());
    if (cfg.hotkeys.sync) globalShortcut.register(cfg.hotkeys.sync, () => clock?.sync());
  } catch (err) {
    console.error('[hotkeys] failed', err);
  }
}

function quitApp() {
  quitting = true;
  config?.flush();
  windowManager?.layout.flush?.();
  app.quit();
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', () => ({
    config: config.get(),
    layout: windowManager.layoutSnapshot(),
    displays: displayList(),
    clock: clock.state(),
    info: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: process.platform,
      userData: app.getPath('userData'),
      timeZones: Intl.supportedValuesOf('timeZone'),
      systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      appPath: ROOT,
    },
  }));

  ipcMain.handle('config:get', () => config.get());
  ipcMain.handle('config:set', (_e, patch) => {
    config.update(patch);
    return config.get();
  });
  ipcMain.handle('config:reset', () => {
    config.reset();
    return config.get();
  });
  ipcMain.handle('clock:state', () => clock.state());
  ipcMain.handle('clock:sync', async () => {
    const state = await clock.sync();
    return state;
  });
  ipcMain.handle('layout:get', () => ({
    layout: windowManager.layoutSnapshot(),
    displays: displayList(),
  }));
  ipcMain.handle('layout:reset', () => {
    windowManager.resetLayout();
    return windowManager.layoutSnapshot();
  });
  ipcMain.handle('instance:add', (_e, { displayId } = {}) => {
    const id = addInstance(displayId || 'auto');
    return { id, instances: config.get().instances };
  });
  ipcMain.handle('instance:remove', (_e, { id } = {}) => {
    const ok = removeInstance(id);
    return { ok, instances: config.get().instances };
  });
  ipcMain.handle('instance:update', (_e, { id, patch } = {}) => {
    if (id && patch) updateInstance(id, patch);
    return config.get();
  });
  ipcMain.handle('instances:one-per-display', () => {
    createOnePerDisplay();
    return { instances: config.get().instances, layout: windowManager.layoutSnapshot() };
  });
  ipcMain.handle('app:openSettings', () => openSettings());
  ipcMain.handle('app:quit', () => quitApp());
  ipcMain.handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('app:setAutostart', (_e, enabled) => {
    config.update({ behavior: { autostart: Boolean(enabled) } });
    return Boolean(enabled);
  });
  ipcMain.handle('app:relaunch', () => {
    config.flush();
    windowManager?.layout.flush?.();
    app.relaunch();
    app.exit(0);
  });

  // —— 版本更新 ——
  ipcMain.handle('update:state', () => updater?.state() ?? null);
  ipcMain.handle('update:check', async () => (updater ? updater.check({ force: true }) : null));
  ipcMain.handle('update:download', async () => (updater ? updater.download() : null));
  ipcMain.handle('update:apply', async () => {
    if (!updater) return { ok: false, error: '更新器未初始化' };
    const result = await updater.apply();
    if (result.ok) {
      log('update: applying, quitting for update');
      setTimeout(() => {
        quitting = true;
        config.flush();
        windowManager?.layout.flush?.();
        app.exit(0);
      }, 400);
    }
    return result;
  });

  ipcMain.on('widget:size', (event, size) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    windowManager.resizeToContent(win, size);
  });

  ipcMain.on('widget:snap', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) windowManager.snapIfNeeded(win);
  });

  ipcMain.on('widget:drag-start', (event, point) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) windowManager.beginDrag(win, point);
  });
  ipcMain.on('widget:drag-move', (event, point) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) windowManager.dragTo(point);
  });
  ipcMain.on('widget:drag-end', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) windowManager.endDrag();
  });

  ipcMain.on('widget:contextmenu', (event, instanceId) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    buildWidgetMenu(instanceId).popup({ window: win });
  });

  ipcMain.on('settings:close', () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  });
  ipcMain.on('settings:minimize', () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.minimize();
  });
  ipcMain.on('settings:toast', (_e, msg) => console.log('[settings]', msg));
}

async function runCapture(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      log(`[capture] win ${win.getTitle()} visible=${win.isVisible()} bounds=${JSON.stringify(win.getBounds())}`);
      win.showInactive();
    }
    await new Promise((r) => setTimeout(r, 2400));
    // 开发调试：截图前在页面里执行一段脚本（例如展开某个下拉框）
    if (process.env.CLOCK_CAPTURE_JS) {
      for (const win of wins) {
        await win.webContents
          .executeJavaScript(process.env.CLOCK_CAPTURE_JS)
          .then((r) => log(`[capture] js result ${JSON.stringify(r)}`))
          .catch((err) => log(`[capture] js failed ${err}`));
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    for (const win of wins) {
      const diag = await win.webContents
        .executeJavaScript(
          `(() => {
            const p = document.querySelector('.panel');
            const r = p ? p.getBoundingClientRect() : null;
            return {
              ready: document.readyState,
              bodyLen: document.body.innerHTML.length,
              hasPanel: Boolean(p),
              rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
              bg: p ? getComputedStyle(p).backgroundColor : null,
              innerW: window.innerWidth,
              innerH: window.innerHeight,
              lunar: typeof window.Solar,
              text: (p ? p.innerText : document.body.innerText).slice(0, 160),
            };
          })()`,
        )
        .catch((err) => ({ error: String(err) }));
      log(`[capture diag] ${JSON.stringify(diag)}`);
      const name = win === settingsWin ? 'settings' : `widget-${windowManager.idOf(win) || 'x'}`;
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
    }
    log(`[capture] wrote ${wins.length} windows to ${dir}`);
  } catch (err) {
    log(`[capture] failed ${err?.stack || err}`);
  } finally {
    quitting = true;
    config?.flush();
    app.exit(0);
  }
}

app.whenReady().then(() => {
  log(`ready userData=${app.getPath('userData')} name=${app.getName()}`);
  registerAppProtocol(ROOT);

  const userData = app.getPath('userData');
  try {
    fs.mkdirSync(userData, { recursive: true });
  } catch (err) {
    // 目录不可写时仍允许运行（配置保存在内存里），避免直接启动失败
    log(`[app] userData not writable ${err.message}`);
  }

  config = new ConfigStore(path.join(userData, 'config.json'));
  clock = new ClockService(config);
  windowManager = new WindowManager({
    config,
    clock,
    rootDir: ROOT,
    userDataDir: userData,
    onRequestSettings: () => openSettings(),
    log,
  });

  registerIpc();
  createTray();
  windowManager.sync();
  log('windows synced');
  applyAutostart(config.get().behavior.autostart);
  registerShortcuts();

  // —— 版本更新：启动 8 秒后检查一次，之后每 6 小时一次 ——
  updater = new Updater({ app, currentVersion: app.getVersion(), config });
  updater.on('state', (state) => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('update:state', state);
  });
  const scheduleUpdateCheck = () => {
    clearInterval(updateTimer);
    if (!config.get().update.autoCheck) return;
    updateTimer = setInterval(() => updater?.check(), 6 * 60 * 60 * 1000);
    if (updateTimer.unref) updateTimer.unref();
    setTimeout(() => updater?.check(), 8000);
  };
  scheduleUpdateCheck();

  // 开发/自测：无人值守跑一遍「检查 → 下载 → 安装」，用本地假 feed 验证升级链路
  if (process.env.CLOCK_AUTOTEST_UPDATE) {
    const doneFile = path.join(os.tmpdir(), 'clock-autotest-done');
    if (fs.existsSync(doneFile)) {
      log('autotest: 已执行过，跳过');
    } else {
      setTimeout(async () => {
        try {
          const checked = await updater.check({ force: true });
          log(`autotest: check ${checked.status} latest=${checked.latestVersion} error=${checked.error || "-"}`);
          if (checked.status !== 'available') return;
          const downloaded = await updater.download();
          log(`autotest: download ${downloaded.status} ${downloaded.progress}%`);
          if (downloaded.status !== 'ready') return;
          fs.writeFileSync(doneFile, new Date().toISOString());
          const result = await updater.apply();
          log(`autotest: apply ${JSON.stringify(result)}`);
          if (result.ok) {
            setTimeout(() => {
              quitting = true;
              config.flush();
              windowManager?.layout.flush?.();
              app.exit(0);
            }, 600);
          }
        } catch (err) {
          log(`autotest: failed ${err?.stack || err}`);
        }
      }, 3000);
    }
  }

  clock.on('state', (state) => {
    windowManager.broadcast('clock:state', state);
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('clock:state', state);
  });
  clock.start();

  config.onChange(() => {
    windowManager.sync();
    rebuildTrayMenu();
    registerShortcuts();
    pushConfig();
    scheduleUpdateCheck();
  });

  app.on('activate', () => windowManager.showAll());
  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    config.flush();
    windowManager.layout.flush?.();
  });
  app.on('will-quit', () => {
    clock?.stop();
    clearInterval(updateTimer);
  });

  screen.on('display-added', () => {
    windowManager.sync();
    pushConfig();
  });
  screen.on('display-removed', () => {
    windowManager.sync();
    pushConfig();
  });
  screen.on('display-metrics-changed', () => {
    windowManager.sync();
  });

  require('electron').powerMonitor?.on('resume', () => {
    clock.sync();
  });

  if (args.includes('--open-settings')) openSettings(argValue('settings-tab') || undefined);
  if (CAPTURE_DIR) runCapture(path.resolve(CAPTURE_DIR));
});

app.on('window-all-closed', () => {
  // 常驻托盘：关闭所有窗口也不退出
});



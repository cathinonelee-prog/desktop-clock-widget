/**
 * 打包便携版：build/DesktopClock-win32-x64/DesktopClock.exe
 * 用法：npm run dist
 *
 * 打包后会裁掉用不到的语言包和可选 GPU 库，减小体积：
 *   - locales 只留 中/英/繁体 → 省约 44 MB
 *   - dxcompiler.dll（DirectX Shader Compiler，透明窗口渲染用不到）→ 省约 24 MB
 * 若某一版 Electron 的显示出问题，可用 KEEP_DXCOMPILER=1 npm run dist 保留它。
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

// 复用本地已下载的 electron 压缩包，避免重复下载
let electronZipDir;
try {
  const cacheDir = path.join(root, '.electron-cache');
  const zip = readdirSync(cacheDir).find((f) => /^electron-v[\d.]+-win32-x64\.zip$/.test(f));
  if (zip) electronZipDir = cacheDir;
} catch {
  /* 没有缓存就让它自己下载 */
}

const paths = await packager({
  dir: root,
  name: 'DesktopClock',
  executableName: 'DesktopClock',
  platform: 'win32',
  arch: 'x64',
  out: path.join(root, 'build'),
  overwrite: true,
  asar: true,
  prune: true,
  appVersion: pkg.version,
  icon: path.join(root, 'resources', 'icon.ico'),
  electronZipDir,
  ignore: [
    /^\/\.(test-data|shots|smoke|electron-cache|npm-cache|tools)(\/|$)/,
    /^\/(tests|scripts|docs|build)(\/|$)/,
    /^\/(README|CHANGELOG|CONTRIBUTING)\.md$/,
    /^\/package-lock\.json$/,
    /\.zip$/i,
    /\.vbs$/i,
  ],
});

const outDir = paths[0];

/** 删除文件并返回省下的字节数 */
function drop(file) {
  if (!existsSync(file)) return 0;
  const size = statSync(file).size;
  rmSync(file, { recursive: true, force: true });
  return size;
}

// 1) 语言包：只保留简体中文、繁体中文、美式英语
const KEEP_LOCALES = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak', 'en-GB.pak']);
let savedLocales = 0;
const localesDir = path.join(outDir, 'locales');
if (existsSync(localesDir)) {
  for (const name of readdirSync(localesDir)) {
    if (!KEEP_LOCALES.has(name)) savedLocales += drop(path.join(localesDir, name));
  }
}

// 2) 可选的 GPU 库：透明窗口 / DOM 渲染走 D3D11，不需要 D3D12 的着色器编译器
let savedDx = 0;
if (!process.env.KEEP_DXCOMPILER) {
  savedDx += drop(path.join(outDir, 'dxcompiler.dll'));
}

// 3) 打包自检：asar 体积异常说明误把产物打进去了
const asar = path.join(outDir, 'resources', 'app.asar');
if (existsSync(asar)) {
  const mb = statSync(asar).size / 1024 / 1024;
  if (mb > 5) console.warn(`⚠ app.asar 有 ${mb.toFixed(1)} MB，检查是否误打包了 build/ 或 zip`);
  else console.log(`app.asar ${mb.toFixed(2)} MB`);
}

const totalMb = [...(function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
})(outDir)].reduce((sum, f) => sum + statSync(f).size, 0);

console.log(
  `已裁剪语言包 ${(savedLocales / 1048576).toFixed(1)} MB` +
    (savedDx ? `、dxcompiler ${(savedDx / 1048576).toFixed(1)} MB` : '') +
    `；解压后合计 ${(totalMb / 1048576).toFixed(1)} MB`,
);
console.log('打包完成：');
for (const p of paths) console.log('  ' + p);

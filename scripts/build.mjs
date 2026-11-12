/**
 * 打包便携版：build/DesktopClock-win32-x64/DesktopClock.exe
 * 用法：npm run dist
 */
import { readdirSync, readFileSync } from 'node:fs';
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
    /^\/\.(test-data|shots|smoke|electron-cache|npm-cache)(\/|$)/,
    /^\/(tests|scripts|docs|build)(\/|$)/,
    /^\/(README|CHANGELOG|CONTRIBUTING)\.md$/,
    /^\/package-lock\.json$/,
    /\.zip$/i,
    /\.vbs$/i,
  ],
});

// 防止再次把打包产物自己塞进 asar
const asar = paths[0] && path.join(paths[0], 'resources', 'app.asar');
if (asar) {
  const { statSync } = await import('node:fs');
  const mb = statSync(asar).size / 1024 / 1024;
  if (mb > 5) console.warn(`⚠ app.asar 有 ${mb.toFixed(1)} MB，检查是否误打包了 build/ 或 zip`);
  else console.log(`app.asar ${mb.toFixed(2)} MB`);
}

console.log('打包完成：');
for (const p of paths) console.log('  ' + p);

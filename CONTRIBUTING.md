# 贡献指南

欢迎 issue、bug 反馈与 PR。这是一个体积很小的 Electron 项目，改起来不复杂。

## 开发环境

- Windows 10 21H2+ / Windows 11（本项目只在 Windows 上验证；其他平台未适配，窗口透明与托盘行为可能不同）
- Node.js 20 或更高版本
- Git

```powershell
git clone https://github.com/cathinonelee-prog/desktop-clock-widget.git
cd desktop-clock-widget
npm install     # 会下载 Electron（约 150 MB）
npm start
```

如果启动后没有任何窗口（多见于受限终端 / 沙箱环境，Chromium 沙箱无法初始化）：

```powershell
.\node_modules\electron\dist\electron.exe --no-sandbox .
```

## 目录结构

```
src/main/        Electron 主进程：窗口、托盘、IPC、配置、授时
src/preload/     contextBridge 暴露给渲染进程的最小 API
src/renderer/    悬浮窗与设置窗的页面、样式与视图渲染
  lib/           时区格式化、农历、节假日、版式定义（纯函数，可单测）
src/data/        内置节假日数据（按年份 JSON）
src/vendor/      内置第三方库 lunar-javascript（MIT）
tests/           node:test 单元测试
scripts/         图标生成与打包脚本
```

几条约定：

- 渲染进程不直接碰 Node，一切能力经 `src/preload/*.js` 暴露。
- 主进程与渲染进程只通过 IPC 通信，频道名统一在 `src/main/main.js` 里注册。
- `src/renderer/lib/*.mjs` 保持纯函数、无 DOM 依赖，方便在 `node --test` 里直接跑。
- 时间相关计算一律用“网络对齐后的 UTC 毫秒 + 目标时区”推导，不要直接用本机 `new Date()` 的本地时间。

## 修改后自查

```powershell
npm test        # 15 个单元测试
npm start       # 手动确认窗口、拖动、右键菜单、设置页
npm run dist    # 需要时再打包
```

改动涉及界面时，请附一张截图；涉及时间/农历/时区时，请在 `tests/` 里补一个用例。

## 提交与 PR

- 提交信息建议用 `fix: ` / `feat: ` / `docs: ` / `refactor: ` / `chore: ` 前缀，例如
  `fix: 去除亮色壁纸下的方形投影切边`。
- 一个 PR 只做一件事；格式化、重命名这类“顺手改”请单独提交。
- PR 里请说明：改了什么、为什么改、怎么验证的（有截图更好）。

## 加新的一年的节假日数据

1. 从国务院办公厅公布的放假安排整理成 `src/data/holidays/<年份>.json`，格式：

```json
{
  "holidays": { "2027-10-01": "National Day,国庆节,3" },
  "workdays": { "2027-09-26": "National Day,国庆节,3" },
  "inLieuDays": { "2027-10-06": "National Day,国庆节,3" }
}
```

字段含义：`holidays` 放假日期、`workdays` 调休上班日期、`inLieuDays` 属于调休的放假日期；
值格式为 `英文名,中文名,法定天数`。程序按年懒加载，文件放进目录即可生效。

2. 在 `tests/holidays.test.mjs` 里补一条该年份的断言。

## 许可

提交代码即表示同意以 MIT 许可证发布。


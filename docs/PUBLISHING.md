# 发布到 GitHub（新手版）

> **本仓库已发布：<https://github.com/cathinonelee-prog/desktop-clock-widget>**
> 第 1–4 步是一次性的，已经做完了。以后发新版只需要看最后一节「之后每次发版的流程」。

这份文档写给第一次发布 GitHub 仓库的人，按顺序做即可。全程只需要复制粘贴命令。

> 下面命令里的 `<你的用户名>` 要换成你自己的 GitHub 用户名，例如 `zhangsan`。
> 仓库名建议用 `desktop-clock-widget`。

---

## 第 0 步：准备账号与工具

1. 注册 / 登录 [github.com](https://github.com)。
2. 安装 [Git for Windows](https://git-scm.com/download/win)（一路默认，会顺带装好凭据管理器）。
3. 打开 PowerShell，确认装好了：

```powershell
git --version
```

> 不想用命令行也可以装 [GitHub Desktop](https://desktop.github.com/)，第 3 步有对应做法。

---

## 第 1 步：在 GitHub 上创建空仓库

1. 右上角 **+** → **New repository**。
2. Repository name 填 `desktop-clock-widget`。
3. 选择 **Public**（公开）或 Private（私有，之后也能改）。
4. **不要**勾选 “Add a README file”“Add .gitignore”“Choose a license”——本地项目里已经有了，勾了反而要处理冲突。
5. 点 **Create repository**。

创建完成后页面会显示仓库地址，形如：

```
https://github.com/<你的用户名>/desktop-clock-widget
```

这个地址就是 **仓库地址**（README 的 clone 命令、徽章、issue 链接都用它）。想确认时可以点页面绿色的 **Code** 按钮，里面 HTTPS 那一栏就是。

---

## 第 2 步：本地初始化仓库

在项目目录（`clock-widget`）里执行：

```powershell
cd <项目目录>

git init -b main
git config user.name "你的名字"
git config user.email "你的邮箱"

git add .
git commit -m "feat: 悬浮时钟 v1.0.3 首个公开版本"
```

`.gitignore` 已经排除了 `node_modules/`、`build/`、测试截图等，所以这次提交只有源码、文档和图标，大约几 MB。

检查一下提交内容（确认没有 node_modules、build）：

```powershell
git status --short
git ls-files | Measure-Object -Line
```

---

## 第 3 步：关联远程仓库并推送

```powershell
git remote add origin https://github.com/<你的用户名>/desktop-clock-widget.git
git push -u origin main
```

第一次推送会弹出一个浏览器窗口要求登录 GitHub（Git 凭据管理器），授权后就会自动上传。

> **用 GitHub Desktop 的话**：File → Add local repository → 选 `clock-widget` → 点 Publish repository → 取消勾选 “Keep this code private”（想公开的话）→ 发布。

推送完成后刷新仓库页面，代码就上去了。

---

## 第 4 步：发第一个 Release（发布便携版 zip）

仓库里只放源码，**打包好的程序放在 Release 里**（GitHub 单文件限制 100MB，未压缩的 build 目录 358MB 放不进仓库，但 Release 附件可以）。

### 方式 A：网页上传（最简单）

1. 本地打包并压缩：

```powershell
npm install
npm run dist
Compress-Archive -Path build\DesktopClock-win32-x64\* -DestinationPath DesktopClock-win32-x64.zip -CompressionLevel Optimal
```

2. 在仓库页面点右侧 **Releases** → **Draft a new release**。
3. **Choose a tag** 输入 `v1.0.3` → 点 “Create new tag”。
4. Release title 填 `v1.0.3`，描述可以直接复制 [CHANGELOG.md](../CHANGELOG.md) 里对应版本的内容。
5. 把 `DesktopClock-win32-x64.zip` 拖到附件区域，**Publish release**。

### 方式 B：打 tag 自动构建（本项目已配置好工作流）

`.github/workflows/release.yml` 会在推送 `v*` 标签时自动跑测试、打包、压缩并创建 Release：

```powershell
git tag v1.0.3
git push origin v1.0.3
```

几十秒后去仓库 **Actions** 页看进度，成功后 Release 里会自动出现附件。

---

## 第 5 步：发布后的收尾（建议都做）

1. **补 README 的 clone 地址**：把 `README.md` 里 “从源码运行” 一节的
   `git clone <你的仓库地址>` 换成真实地址。
2. **加徽章**（可选，粘在标题下面那行图片之后）：

```markdown
[![CI](https://github.com/<你的用户名>/desktop-clock-widget/actions/workflows/ci.yml/badge.svg)](https://github.com/<你的用户名>/desktop-clock-widget/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/<你的用户名>/desktop-clock-widget)](https://github.com/<你的用户名>/desktop-clock-widget/releases)
[![License](https://img.shields.io/github/license/<你的用户名>/desktop-clock-widget)](LICENSE)
```

3. **填仓库信息**：仓库页右上角 **About**（齿轮图标）→ Description 填
   “半透明桌面悬浮时钟：SNTP 网络授时、时区、农历节气节假日、多屏多实例”，
   Website 留空，Topics 建议加：`windows` `electron` `clock` `widget` `desktop` `lunar-calendar` `ntp`。
4. **确认 Actions 可用**：Settings → Actions → General，选择 “Allow all actions”（默认就是）。

---

## 常见坑

| 现象 | 原因 / 处理 |
| --- | --- |
| `remote: error: File ... is 358 MB; this exceeds GitHub's file size limit` | 把 `build/` 提交进去了。先 `git rm -r --cached build`，确认 `.gitignore` 生效后重新提交，zip 放 Release。 |
| push 时一直要密码 / 403 | GitHub 已不支持用账号密码推送。用 Git 凭据管理器登录，或在 GitHub 设置里创建 Personal Access Token 当密码。 |
| 中文文件名显示乱码 | 本项目只有一个 `启动悬浮时钟.vbs`，已用 UTF-16 保存并在 `.gitattributes` 里标记为二进制，正常不会乱码。 |
| clone 下来文件全变成 CRLF | `.gitattributes` 已统一为 LF，无需处理。 |
| Actions 里 `npm ci` 很慢 | 正常，Electron 体积大；CI 已设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` 跳过测试阶段的下载。 |

---

## 之后每次发版的流程

```powershell
# 1. 改代码、改 CHANGELOG.md 和 package.json 里的版本号
npm test
git add .
git commit -m "fix: 修复 xxx"
git push

# 2. 打标签发版（自动构建 Release）
git tag v1.0.4
git push origin v1.0.4
```


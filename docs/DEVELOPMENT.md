# 开发、调试、构建

## 环境

推荐 Node.js 24 LTS + npm；源码采用 TypeScript strict。最终用户不需要开发环境。Electron 44.3.0 内含 Node 与 SQLite，不依赖用户安装数据库。依赖精确版本/lock file 随源码交付。

```sh
npm ci
node node_modules/electron/install.js
npm run dev
```

`dev` 构建前后端后打开桌面程序；开发数据写入 test-data。修改后重新运行，当前未配置 HMR。启动已有构建可运行 `npm start`。

```sh
npm run verify
npm run build
npm run pack:win
```

verify 包括 strict 类型检查、核心 node:test 与 jsdom React DOM 交互检查。测试 fakeCloud 仅存在 tests 目录，生产 Application 使用真实 Provider；UI harness 只用测试专用凭据和受控 HTTP fixture，不会进入软件运行包。

Windows 构建由 @electron/packager 输出 release/吃个糖Agent-win32-x64。程序数据位于程序目录外的 UserDataRoot；旧 portable.flag 仅用于识别旧目录，不再启用程序内数据存储。应用未签名；发布证书属于后续真实发布门槛，源码构建不伪造签名。

可在 Windows PowerShell 执行 `scripts/windows-smoke.ps1` 做无费用启动文件检查。它不会替代后续手工播放、DPAPI、通知和 API 验收。

## 调试原则

日志在 logs 下分 application/api/task/error/download，每个文件大小受限。Key、完整 Prompt、带签名媒体 URL 不输出普通日志。排查任务时通过详情读取原始 API 结果，分享前仍需检查个人内容。

不要用生产数据库跑测试；不要对付费提交开启无条件重试；不要把用户 Key 写环境模板、Git 或测试 fixtures。无需打开终端设置 Key，全部在软件本地账户页输入。

## 文件结构

程序包顶层是 吃个糖Agent.exe 与 Electron 必需运行文件，应用代码在 resources/app/dist，附带本地媒体元数据模块。UserDataRoot 中的可写目录包括 data、assets、projects、outputs、logs、backups；程序包不创建这些目录。不要单独移动 EXE。

资源打包检查会核对 package.json main、preload、前端入口、媒体模块、MZ/PE 标识和 ZIP 完整性；这只能确认包结构，不能代替 Windows 原生运行。


## v1.0.4 视觉回归

运行 scripts/visual-test.mjs 需要 Playwright（QA_PLAYWRIGHT_MODULE 可指定模块路径）、可启动的无头 Chromium（QA_CHROMIUM_PATH）、Noto Sans SC fontsource 包路径（QA_FONT_DIR）。它只启动本机测试服务和临时数据库，真实云端网络调用会报错阻止。普通 npm run verify 不依赖这三个额外视觉测试工具。

# 吃个糖 Agent v1.2.8 — 源码开发基线

本交付仅包含完整源码、必要资源、production build 产物、样例与测试证据，不包含新制作的 Windows 安装包或 Portable 发布包。

## 使用与开发

Node.js 24.19.0 或更新的兼容版本。执行 `npm ci`，随后 `npm test`、`npm run test:ui`、`npm run test:pdf`、`npm run build`、`npm run test:bundle`。
FFmpeg 测试需要可执行的本地 FFmpeg/FFprobe；Windows 产品复用 resources/ffmpeg.exe。`npm run test:browser` 需要另备 Playwright 与浏览器，可设置 PLAYWRIGHT_MODULE 和 CHROMIUM_PATH；它们不属于新增产品依赖。

完整结果见 docs/v128/验收报告.md。旧版本文档保留作历史资料，以本文件及 v1.2.8 报告为准。

## 本版边界

- 旧“一键生成”：按上传 v1.2.4 原码锁定关键调用链，legacy-v124-sha256.json 与自动测试防止漂移。相较 v1.2.7 的回退仅发生于此前明确要求冻结的旧链路。旧内部 brand.version 原文件是 1.2.3，按原码保留；应用对外版本为 1.2.8。
- 视频生成和独立“一键复刻”：WAN 完整音频、Seedance 1.5/2.5、可灵 2.6；模型与账户切换、动态参数、不兼容素材阻止提交、确认修订及去重。API/模型配置入口合并进设置。
- 新复刻包为独立 chigetang.replica 1.0 协议。样例位于 examples/replica。旧包继续走旧“一键生成”。同一个 ZIP 再次导入恢复同一轮，不自动再次计费。需要新一轮时应明确生成新的任务包（例如更新 name）。
- 本地编译器保留，入口位于“一键复刻”，编译结果仍为旧“一键生成”的 WAN 任务包。
- 小工具：视频提取 MP3/WAV；PDF 按全部或指定页码输出 PNG/JPG。默认 200 DPI，独立输出文件夹避免覆盖。没有调用云端 API。
- SQLite 表结构未改变。已有数据库首次启用本版会生成 pre-v128-时间戳.sqlite 备份，保留草稿、账户和原数据目录。

## v1.2.9 接续要求

以本 ZIP 为完整基线，勿以早期开发检查点替代。旧链路哈希测试应持续保留。不要将离线协议测试当作真实云端验收；Windows 原生文件对话框、目录打开、DPAPI、实际模型和真实付费生成仍需相应环境验证。

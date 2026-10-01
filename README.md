# 吃个糖 Agent v1.3.0

当前正式版本为 v1.3.0，真人口播采用 V2.1 / R3。请读 `v1.3.0-Release-Notes.md`、`v1.3.0-Upgrade-Guide.md` 和 `docs/v1.3.0-acceptance/README.md`。

Windows x64 绿色版使用独立程序目录和独立数据目录 `D:\吃个糖Agent数据库-v1.3.0`；本机已通过一致性快照复用原有安全账户、Workspace、Region 和真实复刻音色。旧绿色版、旧数据库、旧 WAV 保留原样。

运行协议：`REAL_SPEECH_EXECUTION_PLAN_V2` / `2.1` / `aliyun.cosyvoice-v3.5-plus.cn-beijing.http` / `1.0.0-draft.3`。此次只验收最小 Plan 导入，未调用云端 TTS、未生成 Golden Case。

以下内容是原有历史说明，不代表 v1.3.0 当前版本和验收结论。

---

# 吃个糖Agent v1.2.3（2026-09-23）

当前版本仅做 UI 优化。请先读 `v1.2.3-Release-Notes.md`、`v1.2.3-Upgrade-Guide.md` 和 `docs/v1.2.3/TEST-REPORT.md`。修改文件说明见 `docs/v1.2.3/CHANGED-FILES.md`。

Windows 包完整解压后运行“吃个糖Agent.exe”。不得覆盖或清空 `D:\吃个糖Agent数据库`。数据库、任务包协议、Binding、服务层、Wan 调用和三阶段 V2.2 资源保持原样。长视频仅移除页面、导航和路由，历史数据保留。导航已将一键生成置顶。

已通过自动化回归及浏览器渲染检查；Windows 本机运行、资源管理器和真实付费 Wan 生成尚未实测。请按 `docs/v1.2.3/WINDOWS-ACCEPTANCE.md` 验收。

以下为原版保留的历史资料，旧版本说明不代表 v1.2.3 当前功能或测试结论。

---

# 吃个糖Agent v1.1.0

在 v1.0.9 Electron + React + SQLite 架构上增量开发。包含 Wan 3.0 统一预检查、批量视频测试版、CosyVoice 工作台改进、失效资产可逆隐藏及紧凑布局。

- 普通用户：先读 `README-USER.md`、`v1.1.0-Upgrade-Guide.md`。
- 下一位开发者：先读 `HANDOFF.md`，其中区分本地验证与待真机验收事项。
- 数据结构：`src/main/database/schema.ts` migration 7；禁止删除数据库解决升级问题。
- 本次验证：`docs/v1.1.0-Test-Report.md`。
- 旧版本文档仅为历史记录，不代表本次验收。

## 开发与构建

需要 Node.js 24.19+。Windows 桌面启动需要 Electron 运行时；真实模型调用需要在软件内配置用户自己的 API Key。

```sh
npm ci
npm run build
npm test
npm run test:ui
npm run test:bundle
npm start
```

测试中的密钥和 HTTP 返回全部为测试夹具，不调用真实付费模型。媒体转换和封面测试需要 FFmpeg 位于 PATH 或设置 `AIVIDEO_FFMPEG_PATH`。

```sh
npm run pack:win
python scripts/package-source.py
```

`AIVIDEO_ELECTRON_ZIP_DIR` 可指定包含 `electron-v44.3.0-win32-x64.zip` 的官方运行时缓存目录。程序包不携带用户数据目录。

## 数据目录

Windows 默认使用软件目录内的 `UserData`，整个软件目录移到其他盘符后可继续读取内部数据。可用设置页分别更改素材、音频、视频和备份目录；历史文件不自动搬移。首次升级会安全复制旧 AppData/便携数据，不删除旧目录。

更多配置、迁移与限制见随包文档。

## 真人口播 Agent Control Interface（源码 CLI）

第一版 CLI 复用现有 V2 Service，提供只读上下文、Patch 预览、受控生成和版本回滚。使用方法、费用确认边界、旧绿色版并发限制与 GW002 离线验收见 [Agent Control Interface V1](docs/agent-control-v1/README.md)。入口为 `node scripts/chigetang.mjs speech <command> --json`；首次执行前用 `npm run build:cli` 准备运行器。

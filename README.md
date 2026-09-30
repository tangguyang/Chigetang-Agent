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

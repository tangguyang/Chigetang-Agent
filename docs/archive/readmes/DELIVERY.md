# 吃个糖Agent v1.2.7

第二阶段本地任务编译。升级与验收请见 `v1.2.7-Upgrade-Guide.md`、`v1.2.7-Release-Notes.md`、`docs/archive/acceptance/v1.2.7/TEST-REPORT.md`。将 Windows 压缩包完整解压到新的程序目录，运行 `吃个糖Agent.exe`；既有 `D:\吃个糖Agent数据库` 保持原位。

---

# 吃个糖Agent v1.2.3（2026-09-23）

当前版本仅做 UI 优化。请先读 `v1.2.3-Release-Notes.md`、`v1.2.3-Upgrade-Guide.md` 和 `docs/archive/acceptance/v1.2.3/TEST-REPORT.md`。修改文件说明见 `docs/archive/acceptance/v1.2.3/CHANGED-FILES.md`。

Windows 包完整解压后运行“吃个糖Agent.exe”。不得覆盖或清空 `D:\吃个糖Agent数据库`。数据库、任务包协议、Binding、服务层、Wan 调用和三阶段 V2.2 资源保持原样。长视频仅移除页面、导航和路由，历史数据保留。导航已将一键生成置顶。

已通过自动化回归及浏览器渲染检查；Windows 本机运行、资源管理器和真实付费 Wan 生成尚未实测。请按 `docs/archive/acceptance/v1.2.3/WINDOWS-ACCEPTANCE.md` 验收。

以下为原版保留的历史资料，旧版本说明不代表 v1.2.3 当前功能或测试结论。

---

# 历史交付：v1.2.2（2026-09-22）

本轮基于 v1.2.1 最小增量修复。任务包机器协议继续使用 `schema_version: "1.2.0"`；已修复声音开关导致的参数保存／提交阻断，统一三阶段 V2.2 指令、单／多任务模板和软件解析，并简化一键生成页面。详见 `v1.2.2-Release-Notes.md`、`docs/archive/acceptance/v1.2.2/TEST-REPORT.md` 和 `docs/archive/acceptance/v1.2.2/WINDOWS-ACCEPTANCE.md`。

---

# 历史交付：v1.2.1 Professional（2026-09-22）

完成全量导入报错、安全清空、已提交包自动新 `task_id`、三份指令和单／多任务成功模板内置。

---

# 历史交付：v1.2.0 R4 最终候选版（2026-09-21）

本轮已完成源码验证和 Windows x64 解压运行包构建；Windows 10/11 真机运行与完整非付费业务流程尚未执行，因此仍为 Candidate。实际结果见 `v1.2.0-Release-Notes.md`、`docs/archive/acceptance/v1.2.0/TEST-REPORT.md` 和 `docs/archive/acceptance/v1.2.0/WINDOWS-ACCEPTANCE.md`；下方 v1.1.1 及更早版本交付记录仅为历史。

---

# 历史交付：v1.1.1 稳定增量版

以 v1.1.1-Release-Notes.md、v1.1.1-Upgrade-Guide.md、docs/archive/acceptance/v1.1.1-Test-Report.md 为本次版本说明。交付完整源码包和 Windows x64 解压运行包；Windows 包完成 PE、版本资源、ZIP CRC、应用文件哈希及用户数据排除验证。当前 Linux 环境未执行 Windows 真机启动，以下保留历史交付记录。

# 吃个糖Agent v1.0.6 交付索引

本版基于 v1.0.5 增量开发，保留原有架构和界面风格。交付 Windows x64 解压运行包，未制作安装向导，也未代码签名。

| 要求               | 交付位置                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1 完整源码         | Source.zip；包含 src、tests、锁文件、构建脚本及应用资源                                                    |
| 2 可运行软件       | Windows-x64.zip；完整解压后运行 吃个糖Agent.exe                                                            |
| 3 数据迁移逻辑     | src/main/services/storage.ts、src/main/database/db.ts、schema.ts；可读 SQL 在 docs/migrations/004-v105.sql |
| 4 CHANGELOG        | CHANGELOG.md                                                                                               |
| 5 测试报告         | docs/archive/acceptance/v1.0.6-Test-Report.md                                                                                 |
| 6 已知问题         | docs/archive/acceptance/v1.0.5-Known-Issues.md                                                                                |
| 7 音频模型配置说明 | docs/archive/acceptance/v1.0.5-Audio-Models.md                                                                                |
| 8 声音复刻使用说明 | docs/archive/acceptance/v1.0.5-Voice-Cloning.md                                                                               |
| 9 升级说明         | v1.0.6-Upgrade-Guide.md                                                                                    |

另附 HANDOFF.md，便于后续开发与原生验收。文档压缩包集中包含上述文档，源码包和程序包也分别附带说明。

## 已验证与待验收

实际编译通过；Node 全量测试和 React/jsdom 检查通过；真实 FFmpeg 完成 22.23 秒视频 + 24.16 秒音频的分段、拼接和音轨回封。

当前环境无法完成 Windows 真机启动、托盘、DPAPI 与音频设备验收；没有使用真实 API Key 执行配音、声音复刻或 Wan 付费调用。程序包已经构建，但不能将交叉打包和模拟服务测试视为上述真实环境验收完成。具体结果和可选未实现项见测试报告与已知问题。

首次升级先阅读升级说明并保留旧数据副本。后续搬迁请复制完整软件目录及其 `UserData`。不要单独复制 EXE，也不要把升级后的数据库交给旧版打开。

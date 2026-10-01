# 吃个糖 Agent v1.3.0

当前正式版本为 v1.3.0，真人口播采用 V2.1 / R3。请读 `v1.3.0-Release-Notes.md`、`v1.3.0-Upgrade-Guide.md` 和 `docs/v1.3.0-acceptance/README.md`。

Windows x64 绿色版使用独立程序目录和独立数据目录 `D:\吃个糖Agent数据库-v1.3.0`；本机已通过一致性快照复用原有安全账户、Workspace、Region 和真实复刻音色。旧绿色版、旧数据库、旧 WAV 保留原样。

运行协议：`REAL_SPEECH_EXECUTION_PLAN_V2` / `2.1` / `aliyun.cosyvoice-v3.5-plus.cn-beijing.http` / `1.0.0-draft.3`。此次只验收最小 Plan 导入，未调用云端 TTS、未生成 Golden Case。

以下内容是原有历史说明，不代表 v1.3.0 当前版本和验收结论。

---

# 吃个糖Agent v1.2.7

离线编译见 src/main/services/localTaskCompiler.ts；任务包机器协议和数据库未改。

---

# 吃个糖Agent v1.2.3（2026-09-23）

当前版本仅做 UI 优化。请先读 `v1.2.3-Release-Notes.md`、`v1.2.3-Upgrade-Guide.md` 和 `docs/v1.2.3/TEST-REPORT.md`。修改文件说明见 `docs/v1.2.3/CHANGED-FILES.md`。

Windows 包完整解压后运行“吃个糖Agent.exe”。不得覆盖或清空 `D:\吃个糖Agent数据库`。数据库、任务包协议、Binding、服务层、Wan 调用和三阶段 V2.2 资源保持原样。长视频仅移除页面、导航和路由，历史数据保留。导航已将一键生成置顶。

已通过自动化回归及浏览器渲染检查；Windows 本机运行、资源管理器和真实付费 Wan 生成尚未实测。请按 `docs/v1.2.3/WINDOWS-ACCEPTANCE.md` 验收。

以下为原版保留的历史资料，旧版本说明不代表 v1.2.3 当前功能或测试结论。

---

# 历史交付：v1.2.2

本版基于 v1.2.1 Patch，不改数据库 schema，不重设计任务包协议。机器协议保持 `1.2.0`；多素材通过“一个别名绑定一个素材 ID、同段使用多个别名”实现。主要调用链为 `resources/workflow` → `src/shared/taskPackage.ts` → `src/main/services/taskPackage.ts` → `src/renderer/pages/OneClick.tsx` → 既有 Wan 任务队列。

已完成源码自动化验证和 Windows x64 交叉打包。当前 Linux 环境不能替代 Windows 真机、真实账户和付费 Wan 验收。继续开发时不得恢复 `audio:false` 的错误硬限制，也不得新增数组 bindings、`tasks[]` 或多 manifest ZIP。

---

# 历史交付：v1.1.1 稳定增量版

以 v1.1.1-Release-Notes.md、v1.1.1-Upgrade-Guide.md、docs/v1.1.1-Test-Report.md 为本次版本说明。已生成 Windows x64 解压运行包并完成静态/结构验证；当前 Linux 环境未执行 Windows 真机启动。schema 仍为 v7，本版无新数据库迁移。以下保留历史交付记录。

# 吃个糖Agent v1.0.6 开发交接

## 当前状态

基于用户的 v1.0.5 源码增量实现；不是重写。已实际构建前端、主进程和 preload，并通过全量逻辑/UI 回归与真实 FFmpeg 长素材集成测试。

没有真实 Key，也没有发起付费生成。Windows EXE 原生启动、托盘/DPAPI/真实账户全链路仍需验收；不要把 mock 成功描述成真实 API 成功。

## 优先接续事项

1. 在 Windows 用户副本上运行，不要先动唯一的生产数据。按升级说明核对账户、密文、素材、工作区、Prompt、项目和任务数量。
2. 实测窗口关闭→托盘→恢复→退出、正在生成时关闭确认、系统音频试听；至少覆盖 100%/150% DPI。
3. 使用用户自己输入软件的百炼 Key，少量验证预置模型的 TTS、声音复刻、重新启动后复用音色，以及音频→Wan 的实际效果。
4. 复核 FFmpeg 二进制及许可证来源、Windows 打包产物；决定正式分发是否需要代码签名/安装向导。
5. 不追加新的大功能，先处理上述验收中出现的具体问题。详情见已知问题清单。

## 代码地图

| 文件                                    | 用途                                                          |
| --------------------------------------- | ------------------------------------------------------------- |
| src/main/services/storage.ts            | UserDataRoot、旧根目录暂存复制、SQLite 一致性快照、目录写权限 |
| src/main/database/schema.ts             | 版本 4：voices、asset_folders、索引、历史 Artifact            |
| src/main/database/db.ts                 | 一次备份、统一事务迁移、完整性检查、失败停止                  |
| src/shared/audioCatalog.ts              | 可持久化的音频能力矩阵、默认模型和各 region 地址              |
| src/main/services/audio.ts              | TTS、复刻、队列、输出、恢复下载、音色兼容与绑定视频           |
| src/main/services/transcode.ts          | 独立 FFmpeg 转换，原文件不覆盖                                |
| src/shared/segmentation.ts              | 分段规划和时间轴 Prompt 裁切                                  |
| src/main/services/thumbnails.ts         | 串行后台视频封面缓存                                          |
| src/main/services/folders.ts            | 任意深度逻辑文件夹、循环检查、删除保留文件                    |
| src/main/services/tasks.ts              | 共用 task_versions；视频调度过滤音频，统一查询                |
| src/main/services/downloads.ts          | 按扩展名发布和文件头校验，不覆盖已有输出                      |
| src/main/index.ts                       | IPC、协议、独立数据路径、托盘及关闭行为                       |
| src/renderer/pages/Audio.tsx            | 独立音频工作台、音色管理、结果和工作区选择                    |
| src/renderer/components/AudioPicker.tsx | 统一参考音频选择器                                            |
| tests/v105.test.ts                      | 11 项 v1.0.5 迁移/音频/目录/资产/真实媒体测试                 |
| tests/v106.test.ts                      | v1.0.6 Mention/Capability/TTS/分段/拼接定向测试               |

## 必须保持的约束

- appVersion 为 1.0.6，schema user_version 为 4；后续禁止删除或清空数据库解决迁移。
- task_snapshots 不可变；音频使用相同 task_versions，type='audio'，请求参数在 snapshot.draft.params.audioRequest。
- voices 保存的是供应商 voiceId，不是 API Key；凭据继续走原 CredentialManager 与 safeStorage。
- 声音复刻 target_model 必须与合成 officialId 完全一致，并校验账户和地域。
- 未知提交结果暂停，不能自动重新发起付费请求。云端成功后下载失败允许只恢复下载。
- 修改保存目录不搬历史文件；文件夹是逻辑分类，禁止偷偷搬真实素材。
- 默认 Windows 数据在软件目录 `UserData`；外部自定义目录保留绝对路径。
- 项目附带的纤姿咖规则为视频复刻业务规则，不是本轮要求开发新爆款 Agent 的授权；没有改写用户 Prompt。

## 构建复现

```sh
npm ci
npm run build
npm test
npm run test:ui
npm run test:bundle
npm run pack:win
python scripts/package-source.py
python scripts/make-delivery.py
```

Node.js >=24.19；Electron 44.3.0。`AIVIDEO_ELECTRON_ZIP_DIR` 可复用同版本官方 ZIP。FFmpeg 路径优先级：设置→AIVIDEO_FFMPEG_PATH→程序内置→系统 PATH。

源码包不包含真实用户数据、Key 或 node_modules；包含锁文件、构建脚本、测试、迁移逻辑、说明和所需应用资源。

## 尚未启用的可选项

三情绪批量版本、声音设计创建、搬移历史文件向导、专业波形时间轴、图片生成工作台均未开发。底层 Artifact 与下载验证支持 image；这不代表已接入图像生成 API。

更多：`v1.0.6-Release-Notes.md`、`v1.0.6-Upgrade-Guide.md`、`docs/v1.0.6-Test-Report.md`。

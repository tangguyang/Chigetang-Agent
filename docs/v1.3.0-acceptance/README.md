# 吃个糖 Agent v1.3.0 正式构建与验收

结论 A：v1.3.0 已具备导入 Golden Case 正式 REAL_SPEECH_EXECUTION_PLAN_V2 的条件。仅说明协议导入能力，不表示已生成或试听 Golden Case 音频。

构建源：当前 dev 分支的完整最新本地工作树，包含未提交 R3。构建前 HEAD 为 f38fd8bb7c778d1829a92213818ddc392a774f67；没有 checkout/reset/clean。正式提交包含全部 R3 与 v1.3.0 修改。

## 交付与运行

- 程序目录：D:\Codex\吃个糖Agent项目\release\v1.3.0\吃个糖Agent-v1.3.0-Windows-x64-绿色版
- 实际验收 exe：上述目录中的 吃个糖Agent.exe；运行记录见 runtime.json。
- 数据根目录：D:\吃个糖Agent数据库-v1.3.0，与旧版 D:\吃个糖Agent数据库 隔离。账户仍采用原有 Windows 安全凭据机制。
- 本机旧账户、Workspace、cn-beijing、黄明昊修正版及其他现有音色通过 SQLite 一致性快照复制；密钥只以系统加密密文保留。本机读取检查只返回布尔值。
- 两版本今后的任务与设置独立保存，没有自动双向同步。

## 实际运行协议

schema = REAL_SPEECH_EXECUTION_PLAN_V2
protocolVersion = 2.1
capabilityProfileId = aliyun.cosyvoice-v3.5-plus.cn-beijing.http
capabilityVersion = 1.0.0-draft.3

运行 Schema/Profile 位于交付程序目录的 resources\app\resources\real-speech-v2 下；schemas 子目录包含 Plan/common/Patch Schema。运行导入实际通过，未退回 V1、未放宽 Schema。

## 测试与真实 UI

- typecheck PASS；全量 179/179；V2 targeted 23/23（包括 Schema、Plan、Patch、intentRanges 不进入请求及版本保护）；UI 71/71。
- 必要旧业务、媒体和迁移回归 53/53；V2 UI、SQLite、离线模拟 WAV、FFmpeg 拼接和诊断工作流 PASS。
- Windows 11 原生 Electron 文档测试 PASS：移动/缩放/最小化/最大化、non-modal、并开、复用、全文复制、工具栏固定、复制失败反馈、关闭与崩溃隔离、安全 preload。
- build、Windows x64 package、PE 1.3.0 元数据、图标、产物哈希、真实 MP4 bundle检查 PASS。
- 从最终绿色包 exe 启动，通过 CDP 操作真实渲染页面及真实 IPC；未 mock 软件接口。设置 → 模型与 API 的旧账户可显示；现有密钥本地解密成功，不回显。
- 真实 UI 选择黄明昊修正版，粘贴 PLAN-MINIMAL-001，点击导入并校验、勾选确认、保存执行方案。runtime.json 与截图为运行证据。
- GW001、原稿/合成文本、只读意图、L0、LOW、experimental=false、instructionIntentCount=0、seed=1234、SSML disabled、lockedFields 正确。完整 Plan 与输入 JSON 深度相等。
- 真实包文档并开/复用、全文复制、滚动固定栏、主窗口继续操作及关闭隔离 PASS。
- Windows 10：未实机验证。

## 边界与资产保护

本轮云端 CosyVoice TTS 请求 0，费用 0，生产音频新增 0，未创建音色。真实 UI 验收使用不可用本地代理阻断外网，未点击任何生成或云端测试按钮。旧任务库只读展示；原旧绿色包、数据库、WAV、凭据状态共 652 文件哈希核对全部不变，见 original-assets.json。

没有生成 Golden Case Plan，没有生成 Golden Case 音频，没有第二批 Spike，没有修改导演稿。测试中的模拟 WAV 仅为临时离线测试夹具。

本轮必要修复：产品版本统一；独立数据目录；打包资源完整性检查；明确执行参数显示验收字段；导入不再自动补写 originalTextHash，派生 planHash 仍独立记录。历史说明原样保留于当前 README 的历史部分。

首次下载 Electron 因连接中断失败，使用本机同版本 44.3.0 缓存重新打包通过。原回归历史哈希检查只允许品牌版本字段变更，其他字节继续验证。native 文档日志中的“模拟剪贴板失败”为主动验证错误提示的成功负例，不是未解决失败。

当前剩余验证：Windows 10 实机；Golden Case 正式 Plan 和真实音频效果需用户后续授权，本轮不执行。Capability Profile 保持用户锁定的 draft.3，没有重新设计协议。

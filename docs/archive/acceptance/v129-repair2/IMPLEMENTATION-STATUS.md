# v1.2.9 修复版2｜实现状态

更新时间：2026-10-01

## 已完成（dev）

- 取消“试演通过”作为正式窗口生成的全局硬门禁。
- 局部窗口参数保存后只标记当前窗口 dirty，可直接重新生成当前窗口。
- 同一窗口每次生成写入新 revision，旧音频不覆盖；窗口内按最新优先显示全部版本，可切换当前使用版本并打开音频文件位置。
- 真人听感诊断区增加“保存并复制优化请求给 ChatGPT”就地入口。
- 原稿修改采用局部语义单元 reconcile：未变化 Phrase/Window 保留 ID、导演标注、参数和历史结果；一对一修改的 Phrase 保留 Phrase 身份并提升 phraseRevision，受影响窗口单独 dirty。
- 新增阶段二协议 `REAL_SPEECH_PERFORMANCE_PLAN_V1`，可直接从 ChatGPT 复制导入，不依赖旧 Director exportId/contextHash。
- 阶段二协议严格绑定 `cosyvoice-v3.5-plus`，并执行本地参数/Instruction 校验。
- 导入后的 Phrase 导演标注可人工修改、保存、取消；不强制经 ChatGPT 修改。
- 真人口播页增加阶段一/阶段二协议文档入口。
- 新增阶段一可编辑 Markdown 导演协议、阶段二机器编译协议，并在 docs/resources 双份镜像。
- 增加“复制阶段一任务给 ChatGPT”：一次复制当前原稿、任务目标、补充要求和阶段一导演协议，减少手工拼资料。
- 增加批量生产入口：生成所有未生成、重新生成所有 dirty、生成已选择；批量付费前明确确认，未知/中断结果仍受计费保护。
- 每个 Window 增加“问 ChatGPT 优化本段”：复制当前 Phrase 导演上下文和真实执行参数；已有 WAV 时同时打开当前音频位置。
- UI 明确区分“导演备注”和“真正发送 CosyVoice 的 Instruction”，避免修改备注却误以为声音已改变。
- 高级参数输入显示 CosyVoice 3.5 Plus 合法范围；非法值、非法 JSON、Instruction 超限均保留“取消修改”出口，不形成死锁。
- Phrase 编辑器修复外部刷新时覆盖未保存草稿的风险。
- 拼接、阶段二导入、试演、批量生成等关键禁用状态增加人话原因。
- 新增 `COSYVOICE-3.5-PLUS-CAPABILITY-LOCK.md`，按 2026-10-01 官方资料锁定执行白名单。
- 新增 GitHub Actions CI 工作流，计划在干净 Linux/Windows 环境执行 typecheck、核心测试、build/UI/bundle 回归。

## 本次补全

- 修复4处TypeScript编译错误。
- 局部原稿改动保留受影响窗口音频历史及当前版本，revision继续递增；保留跨多句Phrase边界。
- 修改参数、音色、原稿或选择旧版本不能绕过unknown/interrupted计费确认。
- 批量一段失败后其他段继续，失败段不自动重试。
- 诊断增加本段范围选择，附件包含当前选择版本；允许重复复制已保存诊断。
- 所有禁用按钮直接显示原因，保存后反馈；拼接结果增加打开文件位置入口。
- 恢复V2.2原版模板ZIP并纳入Git，npm test自动准备WASM；修复旧UI文案和Windows媒体测试路径。
- 新增DOM和Windows Electron五条黄金路径、取消无出口与批量失败回归。

## 已验证

Node24.19.0；typecheck通过；完整核心156/156；口播核心与媒体53/53；通用DOM UI71项；口播三套DOM runner；Windows Electron隔离测试窗口五条黄金路径；build、bundle及Windows x64打包结构/PE/文件哈希通过。

详情见 ACCEPTANCE-RESULTS-2026-10-01.md 和 WINDOWS-PACKAGE-VERIFICATION.json。

## 不可宣称已完成

真实付费CosyVoice声音质量、生产主进程IPC完整现场验收、资源管理器和剪映实际操作；Windows独立交付包启动命令被自动审批拒绝，未验证。Windows测试窗口使用模拟WAV，不能替代真人听感。

## 发布门槛

冻结需求/P0文件不变。任何新发现核心卡死、旧音频覆盖或未知结果自动重试都阻止交付。本次提供源码和Windows测试交付包，并明确上述待现场验收项。

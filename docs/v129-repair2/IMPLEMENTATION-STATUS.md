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

## 已验证

- 真人口播核心三组测试 `v129 + v129-repair + v129-repair2`：47/47 PASS。
- 扩大回归（排除当前源码包缺 `mediainfo.js` 无法运行的 v111/v127）：147/147 PASS（2026-10-01 重新执行）。
- 文档镜像、协议关键字、CosyVoice 模型边界检查通过。
- `tsc --noEmit` 当前无法在本源码包环境执行：缺少 `node_modules/@types/node`。
- UI runner 当前无法执行：源码包未附 `node_modules/esbuild`。这属于测试环境依赖缺失，不视作 UI 已验收。

## 尚未完成 / 不可宣称已完成

- Windows 实机 UI 点击验收。
- 安装依赖后的完整 `npm test` / `npm run test:ui` / `npm run build`。
- 真实 CosyVoice 3.5 Plus 付费声音效果验收。
- 修复版2 Windows 可运行包/安装包。

## 发布门槛

以 `P0-WORKFLOW-ACCEPTANCE.md` 为准。任何核心黄金路径卡死、保存/取消无出口、局部修改导致全局不可生成、旧音频被覆盖、未知请求自动重试等问题，均阻止发布。
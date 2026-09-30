# v1.2.9 修复版2｜实现状态

更新时间：2026-09-30

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

## 已验证

- `tests/v129.test.ts + tests/v129-repair2.test.ts`：37/37 PASS。
- 扩大回归（排除依赖 `mediainfo.js` 的 v111/v127）：147/147 PASS。
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
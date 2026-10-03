# v1.5.0 生产工作流

正式源码为 `D:\Codex\吃个糖Agent项目`；正式软件为 `D:\吃个糖Agent`；生产根仍为 `D:\吃个糖Agent软件数据库`。v1.4.5 tag 保持稳定历史基线，本轮不重做迁移或清理。

## 产品入口

一键复刻 → 一键复制 → 视频生成 → 真人口播 → 音频生成 → 复刻音色 → 转文字 → 小工具 → 生成任务 → 上传素材 → 设置。

原一键生成保留在视频工作台“一键生成 · 任务包”入口，原工作流和协议继续有效。图片参考和素材选择继续保留；没有新增图片生成模型。

生成任务是生产记录，上传素材是输入原料。输入素材选择器继续允许复用已有生成结果，但用户上传页不会混入生成结果。任务备注和收藏保存在主库已有 KV 中，使用带系统命名空间的任务 ID；不使用 asset.favorite。资产收藏仍属于素材本身。

## 索引边界

`ProductionService` 对 TaskService、生成 Asset、RealSpeech、RealSpeech V2 做读取汇总，不迁移业务表。`task:`、`asset:`、`speech:`、`speech-v2:`、`execution:` 是索引 ID，不是第二个任务执行系统。

新视频和 CosyVoice 创建通过 AsyncLocalStorage 保存 GUI/Codex 驾驶来源；新口播导入保存来源；Qwen 请求在执行前持久保存参数及状态，失败也进入生成任务，中断显示待核对，禁止自动重试。历史来源无法证明时显示“历史未知”。索引查询实时读取原系统结果，不依赖 Codex 的临时请求文件。

历史软删除标记保持不变，生成任务的“包括历史已删除记录”可用于检索这些历史任务。收藏不会恢复原删除状态。打开结果和文件夹只能从权威任务的本地输出中选择，不能传入任意 shell 路径。

## Codex 正式驾驶

使用 MCP 的能力发现与调用，或绿色包正式 CLI。新能力：

| 能力 | 用途 |
|---|---|
| production.list / get | 按名称、备注、功能、驾驶来源、状态、收藏、批次查询任务和结果 |
| production.update | 备注 / 收藏；任务语义，独立于素材收藏 |
| production.open | 按索引任务及输出序号打开结果 / 所在文件夹 |
| production.reuse | 返回历史视频的完整独立 Draft，正式执行继续用 tasks.create / again |
| production.references | 查询输入素材被哪些任务引用 |
| uploads.list | 输入素材列表、类型、搜索、文件夹、隐藏筛选 |
| core-assets.list / resolve / register | 长期核心素材发现、SHA256 核验、明确指定登记 |
| copy.create / update | 准备或修改复制批次，不收费、不提交 Provider |
| copy.list / get | 批次、每个底层任务的状态、结果、错误、队列暂停状态 |
| copy.preflight / confirm / submit | 输入检查 → 固定方案确认 → 正式收费提交 |

`copy.create` 接受 requestId、name、count（1–100）、完整 draft 或 sourceTaskId，及可选 variants（与数量一致）、bindings（alias + role）。它不做本地语义分析；Codex 给出完整 Prompt、参数和素材方案。变体完整保存，不摘要或截断。

建议流程：发现能力 → resolve 核心 alias → clone/reuse 历史方案或构造 Draft → copy.create → copy.preflight → 修正 issues → copy.confirm 当前 revision → 获得用户真实付费授权 → copy.submit(confirm:true) → copy.get / production.list(workflowId)。

确认指纹覆盖方案、模型、Provider、账户公开配置和真实素材 SHA256；任何变化须重新预检。创建采用 requestId 幂等；同一已提交批次再次 submit 不新增生成。全部任务先通过现有 TaskService 延迟创建，再释放到现有队列；中断批次保留已创建任务和状态，不自动重提、不自动重试未知付费结果。必要时在原任务详情人工接管，原恢复/取消/再次生成规则继续生效。

技术 confirm:true 不是人类付费授权。队列已暂停时不会擅自全局恢复；GUI 显示提示，人工可在原视频工作台恢复。GUI 和 Codex 使用同一 Writer、Service 与 Provider。

默认 compact 响应提供 workflowId、任务摘要与结果定位；完整 Draft/参数仍保存在正式服务和 resultPath，可通过 normal/debug 读取。不能用 compact 展示摘要替代原始生产输入。

## 长期核心素材

本机目录 `D:\Codex\吃个糖Agent项目\user-assets` 已忽略 Git。包含 person/product/brand/voice/other，机器可读 `manifest.json`，schema=chigetang.core-assets、version=1。每条记录包含 alias/type/path/sha256/updatedAt/description/assetId。

只有用户明确指定时才能调用 core-assets.register，designated:true 是明确指定的声明，不是 Agent 任意挑图的授权。GUI 上传素材详情有“我明确指定此文件为长期核心素材”操作。未指定的上传素材不自动复制；初始化 manifest 为空。

核心目录是长期素材副本与别名登记，不是第二个资产库：生产绑定继续使用现有 AssetManager 的稳定 assetId。按 SHA256 去重，明确登记后同一资产的 managedPath 指向核心副本，原始文件保留。禁止静默覆盖同名 alias；读取时同时校验文件哈希、资产绑定和目录边界。voice 类别是用户指定的参考音频，不冒充已克隆的云端音色 ID；音色克隆仍走原能力和收费授权。

测试使用独立 AIVIDEO_TEST_ROOT，核心素材也在其隔离目录；测试 alias 不进入本机生产 manifest。

## 验收与发布

新增服务测试验证来源、任务收藏与素材收藏隔离、备注外显/搜索、重启持久性、核心 alias 防篡改、批次幂等、确认失效、未知中断拒绝重提、fake Provider 经过现有 TaskService 完整提交/轮询/下载。新增 jsdom 交互测试覆盖任务视图与复制工作流，不冒充原生 GUI 验收。

真实付费服务沿用既有结论；本轮不重复 WAN 验收、不把一键生成 ACCEPTED/WAIVED 改写为真实 WAN PASS，不把 GUI 播放或解码当作人工听感通过。

发布前完整回归、原生 GUI、正式控制链/MCP 验证，再正式构建和统一提交；最终从批准提交重建，使 GUI 与 Agent 的 Version/Commit/Build ID/DataRoot/Executable Path 完全一致。只做正常 dev/main push 和 v1.5.0 tag，不改写 v1.4.5 历史。

# 吃个糖 Agent v1.2.9｜「真人口播」独立模块最终开发需求 V5.0

> **状态：最终锁版开发基线**
>
> **唯一目标：** 以用户提供的三篇真实置顶短视频台词 + 已准备好的真人复刻音色为 Golden Acceptance Set，生成三条“像同一个真人面对镜头，在同一次录制里自然讲完”的可发布口播。
>
> 本版本新增左侧独立功能 **「真人口播」**，位于现有「音频生成」上方。  
> **不改造、不替换、不破坏原「音频生成」工作台。**
>
> 本版本 **不新增 LLM API、不部署本地大模型**。  
> ChatGPT 作为外部“导演与诊断大脑”；吃个糖 Agent 负责上下文整理、协议导入/校验、CosyVoice 生成、状态管理、文件管理、听感反馈、修复和回归保护。

---

# 0. 最终产品定义

v1.2.9 不是“高级 TTS 参数页”，而是：

> **软件负责事实、参数、状态、音频生成和安全执行；ChatGPT负责语义理解、表演导演、复杂听感诊断和修复决策；用户只负责目标、试听、勾选和确认。**

完整闭环：

```text
台词
→ 软件结构化上下文
→ 一键导出给 ChatGPT
→ ChatGPT 导演
→ 固定协议返回
→ 软件严格校验
→ 用户确认
→ CosyVoice 试演/生成
→ 用户小白听感诊断
→ 一键导出诊断给 ChatGPT
→ ChatGPT 修复决策
→ 固定协议返回
→ 软件定向重生成
→ A/B
→ Golden Sample
```

---

# 1. 完成标准

v1.2.9 只有同时满足以下条件才算完成：

1. 左侧存在独立「真人口播」，原「音频生成」完整保留；
2. 真人口播任何故障不影响原「音频生成」；
3. 三篇真实台词全部完成真实 E2E；
4. 三篇最终音频均达到可发布；
5. 完整听感优先像真人，而不是 AI 合成；
6. 同一篇从开头到 CTA 像一次连续录制；
7. 不出现明显新闻播音、主持、企业宣传片、直播喊卖、逐字念稿和明显拼接；
8. 用户不需要使用声音专业术语即可完成反馈；
9. ChatGPT 返回可以被软件安全、稳定、无歧义地执行；
10. 任何 ChatGPT 方案在执行前都必须通过 Runtime Schema、版本、任务状态、参数能力和锁定字段校验；
11. 所有 CosyVoice `instruction` 同时满足：
    - **汉字数量 ≤ 40**
    - **API 加权计数 ≤ 100**
12. production build 成功；
13. 必要自动测试和旧功能回归测试通过；
14. 三篇 Golden Sample 人工完整试听 QC 通过。

**Golden Sample 不要求所有问卷都“非常符合”。**  
实际标准是：无明显 AI 违和、关键真人感项目至少“基本符合”、无关键发音/接缝问题、用户愿意正式发布。

---

# 2. 明确不做

v1.2.9 首版不做：

- 新的 OpenAI / Qwen / DeepSeek 文本 API；
- 本地大模型；
- 自动控制 ChatGPT 网页；
- 假装软件本身有 LLM 语义导演能力；
- “真人度 98 分”等虚假自动评分；
- 重做现有音色克隆系统；
- 重写原「音频生成」；
- 无限增加口播类型；
- 用大量 Seed 抽卡代替问题定位；
- 用长 Crossfade 掩盖表演不连续；
- 自动修改 Original Text；
- 让 ChatGPT 控制 API Key、路径、数据库、Shell、SQL 等危险字段。

---

# 3. 独立模块与故障域

左侧：

```text
真人口播
音频生成
……
```

## 3.1 独立路由/目录

建议：

```text
/real-speech
src/features/realSpeech/
```

真人口播独立拥有：

- Page / Components
- Store
- Domain Model
- ChatGPT Task Exporter
- Director Plan Importer
- Execution Plan Importer
- Runtime Schema Validator
- Instruction Validator
- Job Manager
- CosyVoice Adapter
- Persistence
- QC
- Document Viewer

IPC 独立 namespace：

```text
realSpeech:*
```

## 3.2 独立持久化

优先：

```text
real_speech.db
```

仅保存对现有 Voice ID / Provider / Model 的引用。

若当前真实架构使用第二 DB 代价明显过高，才允许旧 DB 新增独立表；必须事务 migration。

升级前：

- 对真人口播 DB 做一次版本级备份；
- migration 失败必须回滚；
- 不得污染旧音频数据。

## 3.3 Lazy Load

未打开真人口播：

- 不加载真人口播业务逻辑；
- 不启动其任务队列；
- 不读写其 DB；
- 不影响 App 启动。

## 3.4 Error Boundary

下列故障只能影响真人口播：

- DB 损坏；
- 协议 JSON 错；
- 文档丢失；
- CosyVoice 请求失败；
- FFmpeg 失败；
- 输出目录异常；
- React 页面异常。

旧「音频生成」仍必须可用。

---

# 4. 共享基础设施边界

可安全复用：

- Provider 配置；
- API Key / Workspace；
- CosyVoice Model；
- 已克隆 Voice ID；
- 用户数据目录；
- FFmpeg / ffprobe；
- 通用文件选择器；
- 日志；
- HTTP 基础设施。

若必须改共享层：

- 只允许向后兼容增量；
- 旧调用不传新字段时行为必须不变；
- 必须补旧音频回归测试；
- 禁止为了真人口播大规模重构共享代码。

---

# 5. 工作台顶部文档必须永远保持最新版

顶部固定：

```text
真人口播表演生产系统    [📄 使用手册] [🔒 ChatGPT返回协议]
```

打包：

```text
docs/真人口播表演生产系统_使用手册_V5.0.md
docs/ChatGPT_真人口播返回协议_V1.2.md
```

代码常量：

```text
APP_VERSION = "1.2.9"
MANUAL_VERSION = "5.0"
PROTOCOL_VERSION = "1.2"
CAPABILITIES_VERSION = 1
```

production build 前自动测试：

- 两个文件存在；
- 版本与代码常量一致；
- 协议示例 JSON 能通过 Runtime Schema；
- 协议白名单与代码白名单一致；
- 文档被真正打包。

任一不一致：

> 测试 / build 不通过。

**Runtime Schema 是执行真值；Markdown 是人类可读说明。**

---

# 6. ChatGPT 协作模式

本版没有内置 LLM，因此 UI 不再使用“自动 AI 判断”这种容易误导的表述。

生成模式：

```text
● ChatGPT导演（推荐）
○ 连续一镜到底（手动）
○ 导演分段（手动）
```

## ChatGPT导演

```text
一键导出给 ChatGPT
→ ChatGPT 返回 Director Plan
→ 导入 ChatGPT 方案
→ 校验
→ 预览
→ 应用
```

## 连续一镜到底

无 ChatGPT 时仍可：

- 选 Voice；
- 填台词；
- 填 Instruction；
- 连续生成。

## 导演分段

无 ChatGPT 时允许人工划分 Generation Window。

**ChatGPT 不可用时，真人口播不能整个瘫痪。**

---

# 7. 软件 → ChatGPT：自然语言任务包

核心按钮：

```text
一键导出给 ChatGPT
```

任务类型：

- Director Task
- Diagnosis Task
- Repair Task
- Final QC Task

点击后自动：

1. 生成 `CHATGPT_TASK.md`；
2. 全文复制到剪贴板；
3. 准备需要的 WAV；
4. 打开附件目录；
5. 记录 exportId；
6. 保存 taskId / taskRevision / contextHash / capabilitiesVersion；
7. 可选输出 ZIP。

无 ChatGPT API 时，按钮不能命名“自动发送”。

---

# 8. ChatGPT Task 必须自动包含

至少：

- 任务类型；
- 用户目标；
- 用户自由描述；
- Original Text；
- Stable Unit ID；
- Synthesis Text；
- Voice 显示名和安全内部引用；
- Speaker Profile；
- Performance Arc；
- Beats / Windows；
- 当前 Instruction；
- Instruction 本地计数；
- Rhythm / SSML；
- Pronunciation；
- rate / pitch / volume；
- Seed；
- Generation Snapshot；
- 小白听感问卷；
- 问题时间范围；
- Repair History；
- Signature Phrase / Golden Sample 可用信息；
- taskId；
- taskRevision；
- exportId；
- contextHash；
- capabilitiesVersion；
- 当前软件真实支持 action / field / enum / 参数范围；
- `instruction` 限制：
  - 汉字 ≤ 40
  - API 加权 ≤ 100
- 最终必须返回哪个 Schema。

正常情况下用户不需要再次上传完整 🔒 协议文件。

---

# 9. Stable Unit ID

禁止字符 offset 定位。

软件将 Original Text 拆为只读最小语义单元：

```text
U001｜……
U002｜……
U003｜……
```

规则：

- Original Text 不变时 ID 稳定；
- Original Text 真正变化时提升 taskRevision 并重新生成 Units；
- ChatGPT 只能引用存在的 Unit；
- 未知 Unit 直接拒绝；
- Original Text 不允许由 ChatGPT 协议修改。

---

# 10. ChatGPT → 软件：两个唯一 Schema

只支持：

```text
CHATGPT_DIRECTOR_PLAN_V1
CHATGPT_EXECUTION_PLAN_V1
```

自然语言解释只给人看。

软件只执行最终 JSON。

Director Plan 用于：

- Speaker Profile
- Performance Arc
- Beats
- Windows
- Rehearsal
- Pronunciation
- QC Focus

Execution Plan 用于：

- UPDATE_ONLY
- REGENERATE_WINDOW
- REGENERATE_REPAIR_WINDOW
- JOINT_REPAIR
- RECONCAT_ONLY
- NO_CHANGE

不得再发明多套协议。

---

# 11. 协议防旧方案与重复执行

所有 Plan 必须有：

```text
schema
protocolVersion
capabilitiesVersion
planId
taskId
taskRevision
exportId
contextHash
```

软件同时计算：

```text
planHash = canonicalJsonHash(plan)
```

防护：

- taskId 不同 → 拒绝；
- revision 不同 → 拒绝；
- exportId 不同 → 拒绝；
- contextHash 不同 → 拒绝；
- planId 已执行 → 拒绝；
- planHash 已执行 → 拒绝。

避免：

- 旧 ChatGPT 结果覆盖新状态；
- 重复粘贴导致重复扣费；
- ChatGPT 复用了相同 planId。

---

# 12. 协议解析安全

用户可以复制整个 ChatGPT 回复。

软件：

1. 安全剥离 Markdown code fence；
2. 只寻找已知 schema；
3. 0 个合法协议块 → 拒绝；
4. 恰好 1 个 → 继续；
5. 多于 1 个 → 拒绝，不能猜；
6. 严格 JSON；
7. `additionalProperties: false` 或等效严格校验；
8. 不做语义“智能修 JSON”。

JSON 错：

提供：

```text
复制协议纠错请求
```

让 ChatGPT 重发。

---

# 13. Runtime Schema 校验顺序

```text
JSON syntax
→ schema
→ protocolVersion
→ capabilitiesVersion
→ taskId
→ taskRevision
→ exportId
→ contextHash
→ planId / planHash
→ Unit ID
→ Beat ID
→ Window ID
→ field 白名单
→ value 类型
→ 参数范围
→ CosyVoice 当前能力
→ Instruction 双硬限制
→ 锁定字段
→ 变更影响范围
```

全部通过才允许进入 Diff Preview。

---

# 14. ChatGPT 可修改白名单

允许：

```text
speakerProfile
performanceArc
instruction
synthesisText
pronunciation
rhythmData
transitionPauseMs
rate
pitch
volume
seed
```

永久禁止协议修改：

```text
originalText
voiceId
apiKey
workspaceId
providerCredential
localFilePath
databasePath
executablePath
shellCommand
sql
```

Voice ID 必须由用户 UI 手动切换。

---

# 15. Instruction：P0 硬约束

这是本版本最高风险接口字段之一。

已核验 CosyVoice 当前官方规则：

- `instruction` API 加权字符数不得超过 100；
- 汉字（含简/繁、日文汉字、韩文汉字）按 2 计；
- 其他字符（标点、字母、数字、假名、谚文、空格等）按 1 计。

**项目额外安全限制：汉字数量不得超过 40。**

因此所有 Instruction 必须同时满足：

```text
hanCount <= 40
weightedCount <= 100
```

适用于：

- ChatGPT Director Plan；
- ChatGPT Execution Plan；
- 手工输入；
- Repair；
- Signature Phrase；
- Golden Sample 复用；
- 任何最终发给 CosyVoice 的 instruction。

## 15.1 计数必须本地实现

**不得信任 ChatGPT 自报计数。**

JavaScript/TypeScript 实现必须基于 Unicode code point，不得直接使用 `string.length`。

推荐语义：

```text
for each Unicode code point:
  if Script=Han: +2 weighted, +1 hanCount
  else: +1 weighted
```

注意：

- 空格 = 1；
- 标点 = 1；
- 英文/数字 = 1；
- emoji 等非 Han code point 按 1；
- 不以 UTF-16 surrogate pair 数量计数。

## 15.2 UI

Instruction 输入框实时显示：

```text
汉字 27 / 40
API计数 59 / 100
```

两个都通过：

```text
✓ 可生成
```

任一超限：

- 禁止请求 CosyVoice；
- 禁用生成；
- 不自动截断；
- 不静默删除；
- 不自动改写。

提供：

```text
复制精简请求
```

让 ChatGPT 保持原意压缩后重新输出完整协议 JSON。

## 15.3 不允许机械拼接导演字段

不得：

```text
Speaker Profile + Arc + Beat + 禁止项 + …
```

全部拼进 Instruction。

Instruction 只保留当前 Generation Window 最重要的表演方向。

建议常态 18～32 个汉字；**40 个汉字是项目硬上限，不是目标长度。**

---

# 16. 五层表演数据模型

```text
Speaker Profile
      ↓
Performance Arc
      ↓
Performance Beat
      ↓
Generation Window
      ↓
Repair Window
```

**Beat ≠ Window。**

分析可以细，真正 TTS 生成尽量连续。

---

# 17. Speaker Profile

长期人物基线，例如：

- 面对手机镜头；
- 直接；
- 可信；
- 松弛；
- 有专业感但不端；
- 可轻微调侃；
- 销售时不喊；
- 不新闻播音；
- 不主持；
- 不企业宣传片；
- 不逐字念稿。

---

# 18. Performance Arc

描述本篇从开头到结尾的连续变化：

- energy
- intimacy
- seriousness
- persuasion
- tempo
- emphasis

这些属于导演语义，不需要机械逐秒映射到 API 参数。

---

# 19. Performance Beat / Generation Window

Beat 可以是：

- 反问
- 判断
- 调侃
- 叙事
- 转折
- 专业解释
- 枚举
- 价格
- CTA

Generation Window 才是真正的 CosyVoice 请求单位。

原则：

> 相邻 Beat 能在同一自然表演中完成，就合并生成。

避免：

- 每句重新起音；
- 每段重新进入状态；
- 音色/情绪漂移；
- 过多拼接。

---

# 20. Repair Window

问题区域不能默认只重做一句。

优先寻找：

- 自然停顿；
- 语义边界；
- 呼吸边界；
- 前后连续上下文。

必要时：

```text
上一 Beat 尾部 + 当前问题 + 下一 Beat 开头
```

如果 Window 边界仍然接不上：

```text
JOINT_REPAIR
```

跨相邻 Window 联合重生成。

---

# 21. Original / Synthesis 分离

永久保存：

```text
Original Text
Synthesis Text
```

Original：

- 用户原稿；
- 协议不得修改。

Synthesis：

仅为 TTS，可包含：

- 标点；
- 数字读法；
- 英文；
- 多音字；
- 产品名；
- pronunciation；
- 必要 SSML。

UI 必须可 Diff。

---

# 22. Control Ownership

默认控制职责：

| 目标 | 首选控制层 |
|---|---|
| 聊天/播音感 | Instruction |
| 情绪/人物状态 | Instruction |
| 基础语速 | rate（谨慎） |
| 基础音高 | pitch（谨慎） |
| 基础音量 | volume |
| 精确必要停顿 | SSML |
| 发音 | pronunciation / 当前接口支持能力 |
| 数字 | say-as / synthesisText |
| Window 间停顿 | transitionPauseMs |
| 随机性 | Seed |

同一变量被多层冲突控制时：

> 生成前阻止或明确归一。

---

# 23. SSML

原则：

```text
语义
> 自然标点
> Speaker Profile
> Performance Arc
> Instruction
> 模型自然韵律
> SSML 定点修正
```

禁止：

- 每逗号加 break；
- 固定统一停顿；
- 整篇毫秒级编程。

SSML 只修模型自然韵律确实失败的点。

---

# 24. Pronunciation

三篇至少检查：

- 纤姿咖
- 上海衡元生命科学研究中心
- 二纤一菌
- 阿拉比卡
- 双歧杆菌
- 中国膳食纤维咖啡标准
- 99元
- 100杯
- 299元
- 150多项
- 0脂肪
- 0蔗糖
- “破平台食谱”读法需用户确认，不允许 AI 猜

开发时按当前真实 CosyVoice 调用路径核验：

- hot_fix
- phoneme
- say-as
- language_hints
- SSML

只实现真实支持能力。

---

# 25. Seed

Seed 不是“真人感按钮”。

问题排查顺序：

1. Speaker / Arc；
2. Instruction；
3. 文本/发音；
4. Rhythm；
5. Window；
6. rate/pitch/volume；
7. 最后才 Seed。

保存满意结果时必须保存完整 Request Snapshot。

---

# 26. 小白听感诊断

软件内置：

```text
真人听感诊断
```

一级 10 题：

- 非常符合
- 基本符合
- 不太符合
- 完全不符合
- 听不出来 / 不确定

再采集：

- 第一次不自然的位置；
- 最明显问题；
- 动态二级问题；
- 自由描述。

用户可以只写：

> “说不清，就是觉得假。”

软件把问卷 + 参数 +上下文一起导出给 ChatGPT。

---

# 27. Diagnosis 不以 ChatGPT 必须听 WAV 为单点依赖

Diagnosis Task 应准备 WAV。

但不同 ChatGPT 入口的音频处理能力可能不同，因此第一轮诊断必须至少可基于：

- 小白问卷；
- 问题位置；
- 台词；
- Director Plan；
- 参数；
- Repair History。

WAV 是强证据，不是唯一依赖。

---

# 28. 试演 Gate

正式全文前先 8～15 秒。

流程：

```text
Director Plan
→ 试演
→ 快速听感
```

基础方向不通过：

> 不建议直接全文生成。

---

# 29. A/B 连听

每次 Repair 后只比较：

```text
A：上一版
B：当前版
```

选：

- A 更自然
- B 更自然
- 差不多
- 都不好

禁止默认展示十几个抽卡结果。

---

# 30. Repair History

保存：

- 问卷；
- 问题位置；
- ChatGPT Plan；
- 实际改动；
- Before/After；
- A/B 结论；
- 用户结论。

下一次任务自动附带最近相关历史。

---

# 31. 停止规则

同一个 Window + 同一种问题：

1. 第一轮：改主因；
2. 第二轮：扩大上下文 / 检查次因；
3. 第三轮仍失败：禁止继续同策略抽卡。

升级检查：

- Voice 源；
- Window 设计；
- 连续 vs 分段；
- Repair Window；
- 原文天然难读点。

---

# 32. Signature Phrase

满意固定句保存表演方案：

- intent
- instruction
- rhythm
- pronunciation
- parameters
- 结果信息

默认复用表演方式，不强制复用旧音频。

---

# 33. Generation Window 状态机

```text
pending
generating
generated
confirmed
dirty
failed
interrupted
unknown_result
```

## interrupted

程序崩溃/重启时发现旧 `generating`：

> 标记 interrupted，不自动重试。

## unknown_result

请求已发送但网络超时，无法确认服务端是否成功：

> 标记 unknown_result，**禁止自动重试**，避免重复计费。

必须由用户确认后再决定是否重新请求。

---

# 34. 防双击与重复扣费

每次 TTS 请求生成：

```text
clientRequestId
requestSnapshotHash
```

同一 Window 同一 Snapshot：

- 正在生成时禁止第二次提交；
- UI 按钮进入 busy；
- 双击不得产生两次 API 请求。

自动 retry 仅允许：

- 明确“请求未发送”的本地错误；
- 或官方明确保证幂等的场景。

对于“请求可能已被服务端接收”的超时：

> 不自动 retry。

---

# 35. 文件安全

每次生成结果必须使用唯一不可覆盖路径，例如：

```text
outputs/
  taskId/
    GW001/
      rev0003/
        audio.wav
        request.json
```

规则：

- confirmed 音频永不原地覆盖；
- 新生成写新 revision；
- 临时文件先写 `.tmp`；
- 完整成功后 atomic rename；
- 拼接失败不得破坏上一版 final；
- final 也使用 revision 或 snapshot 管理；
- 删除历史必须用户明确操作。

---

# 36. 数据原子性与崩溃恢复

所有 Plan 应用：

```text
Begin transaction
→ 校验
→ 更新配置
→ 保存 Snapshot
→ Commit
```

失败：

> rollback。

付费生成请求和 DB 事务不能伪装成真正分布式原子事务。

正确做法：

- 请求前先持久化 `pending/generating` + Request Snapshot；
- API 返回后再持久化结果；
- 崩溃后通过状态恢复；
- 不自动假设“没结果 = 没计费”。

---

# 37. WAV / 48k

正式输出优先：

```text
WAV / 48000Hz
```

若当前真实接口原生支持：

> 直接请求。

生成后 ffprobe 验证：

- codec；
- sample rate；
- channels；
- duration。

不能只看扩展名。

---

# 38. FFmpeg 拼接

复用项目已有 FFmpeg。

不得重复引入。

段内：

```text
rhythmData / SSML
```

段间：

```text
transitionPauseMs
```

禁止双重停顿。

只修改 transitionPause：

> 不调用 CosyVoice，只重新拼接。

允许：

- 极短技术 fade；
- 轻量 gain match。

禁止：

- 长 Crossfade 掩盖语调/情绪不连续；
- 默认重压缩真人动态。

---

# 39. 三篇 Golden Acceptance Case

顺序固定：

```text
CASE 1 → CASE 2 → CASE 3
```

## CASE 1
重点：

- 强开场；
- 反问；
- 调侃；
- 记忆句；
- 价格；
- CTA。

## CASE 2
重点：

- 创始人叙事；
- 真实吐槽；
- 工厂经历；
- 故事 → 专业 → 产品；
- 固定品牌句一致性。

## CASE 3
重点：

- 专业解释；
- 身份；
- 长机构名；
- 成分；
- 检测；
- 长句；
- 枚举；
- 权威但不播音；
- 成交不突然主播化。

三篇必须用同一套通用系统完成，不能在代码里硬编码“Case1 就这样切”。

---

# 40. 单 Case 标准工作流

```text
1 新建任务
2 选现有 Voice ID
3 粘贴 Original Text
4 生成 Unit ID
5 一键导出给 ChatGPT（Director）
6 Ctrl+V 到 ChatGPT
7 ChatGPT 返回 Director Plan
8 导入 ChatGPT 方案
9 严格校验
10 Diff Preview
11 用户应用
12 生成 8～15 秒试演
13 用户快速听感
14 不通过 → 导出 Diagnosis + WAV
15 ChatGPT 返回 Execution Plan
16 导入/校验/预览
17 定向重生成
18 A/B
19 试演通过
20 正式全文
21 完整连听
22 通用问卷 + Case专项
23 有问题 → Repair
24 同类最多 3 轮
25 用户选择“可发布”
26 设为 Golden Sample
27 保存全部 Snapshot / Repair History
```

---

# 41. UX 顺手性硬要求

正常操作不应要求用户：

- 自己抄 Seed；
- 自己找 SSML；
- 自己解释 Window；
- 自己写 JSON；
- 自己计算 Instruction；
- 每次上传协议全文；
- 自己找哪个 WAV 是最新。

### 生成前

```text
一键导出给 ChatGPT
→ Ctrl+V
→ 发送
```

### 诊断

```text
做问卷
→ 一键导出给 ChatGPT
→ 软件打开附件目录
→ 拖当前 WAV
→ Ctrl+V
→ 发送
```

### 返回

```text
复制 ChatGPT 回复
→ 导入 ChatGPT 方案
→ 看 Diff
→ 应用
```

---

# 42. 必须有的测试

## A. 隔离
- 真人口播 DB 不存在；
- DB 损坏；
- React Error Boundary；
- 文档丢失；
- CosyVoice失败；
- FFmpeg失败；
- 协议错误；
- 均不得影响旧音频生成。

## B. Instruction
必须测试：
- 40 个汉字；
- 41 个汉字；
- 50 个汉字；
- 39 汉字 + 标点；
- 40 汉字 + 足量非汉字符号导致 weighted >100；
- 英文/数字/空格；
- emoji；
- Unicode Han 扩展字符；
- 不得使用 JS `string.length` 作为官方计数。

## C. Protocol
- 合法 Director；
- 合法 Execution；
- 多 JSON；
- 语法错；
- 额外未知字段；
- 错 taskId；
- 旧 revision；
- 错 exportId；
- hash 不符；
- planId 重复；
- planHash 重复；
- 未知 Unit/Window；
- 越权字段；
- NO_CHANGE；
- RECONCAT_ONLY；
- JOINT_REPAIR。

## D. 请求安全
- 双击生成只发一次；
- 网络明确未发送可安全重试；
- ambiguous timeout 不自动重试；
- 崩溃后 generating → interrupted；
- unknown_result 不自动生成第二份；
- confirmed 音频不覆盖。

## E. 文档同步
- Manual V5.0；
- Protocol V1.2；
- Runtime Schema；
- 示例 JSON；
- 白名单；
- bundle。

## F. 三篇真实 E2E
全部真实跑通。

## G. v1.2.8 回归
必要旧测试继续通过。

---

# 43. 开发阶段

## Stage A｜隔离与稳定底座
- 导航；
- route；
- lazy load；
- Error Boundary；
- DB；
- 输出目录；
- crash recovery；
- 文档入口；
- 旧音频回归。

## Stage B｜ChatGPT Bridge
- Unit ID；
- Task Export；
- Clipboard；
- 附件目录；
- Runtime Schema；
- Import；
- Diff；
- revision/hash/exportId/plan；
- docs sync tests。

## Stage C｜真人口播领域层
- Speaker；
- Arc；
- Beat；
- Window；
- Repair；
- Signature Phrase；
- Repair History；
- A/B。

## Stage D｜Instruction / CosyVoice
- 精确计数；
- 40汉字项目硬限；
- 100加权 API硬限；
- CosyVoice 能力核验；
- WAV48k；
- FFmpeg。

## Stage E｜小白诊断
- 一级10题；
- 动态二级；
- Case专项；
- 停止规则。

## Stage F｜Golden Samples
- Case1；
- Case2；
- Case3；
- 只基于真实听感迭代。

---

# 44. 最容易卡住的地方与固定处理

1. **ChatGPT 输出 Instruction 太长**  
   → 本地双计数硬拦截 + 复制精简请求。

2. **ChatGPT JSON 格式偶发错误**  
   → 不猜修，复制协议纠错请求。

3. **用户修改任务后又导入旧方案**  
   → revision + exportId + contextHash 拒绝。

4. **双击/超时重复收费**  
   → requestId + busy lock + unknown_result。

5. **分析太细导致生成太碎**  
   → Beat/Window 分离。

6. **用户越听越乱**  
   → 只比较上一版 vs 当前版。

7. **同一问题无限优化**  
   → 3轮停止规则。

8. **ChatGPT某次不能直接处理 WAV**  
   → 问卷 + 参数仍可第一轮诊断。

9. **协议文档过期**  
   → build 强制版本同步。

10. **真人口播崩溃拖垮旧音频**  
    → 独立模块/DB/Error Boundary/回归测试。

---

# 45. 最终交付

1. v1.2.9 完整源码 ZIP；
2. Windows 可运行版本；
3. 当前发布体系支持的安装版；
4. 绿色版；
5. SHA256；
6. 使用手册 V5.0；
7. ChatGPT 返回协议 V1.2；
8. 小白听感诊断手册；
9. 三篇样片验收基准；
10. 三篇 Golden Sample；
11. 测试报告；
12. production build 结果；
13. v1.2.8 回归结果。

---

# 46. 最终原则

> **ChatGPT 决策，软件约束并执行；用户只负责听和确认。**

> **任何稳定性设计都必须优先避免：误执行、旧方案覆盖、重复计费、数据污染、好结果被覆盖和原「音频生成」回归。**

> **v1.2.9 的成功不是功能数量，而是三篇真实台词最终真的像真人自然说出来，并且整个流程可以反复、安全、稳定地运行。**

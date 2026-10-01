# 真人口播执行系统 V2｜R2设计评审包

状态：设计草案，等待老唐确认；核验日期：2026-10-01（北京时间）。本次只新增设计资料，没有修改软件源码、现有正式文档、数据库或打包资源，也没有调用付费 TTS。

## 结论与需要确认的取舍

采用“ChatGPT 导演讨论 → 用户确认导演稿 → ChatGPT 编译 Plan → 吃个糖校验并执行 → 用户试听 → ChatGPT 局部 Patch”的单向责任链。保留现有可靠的资产、请求快照、旧音频保留、下载恢复与 FFmpeg 拼接基础，重构真人口播领域模型和首页，不在旧导演流程上继续加按钮。

建议确认以下设计取舍：

1. 取消汉字≤40的额外硬门槛，只校验官方 instruction 加权≤100；可显示短指令建议，但不拦截符合官方规则的指令。
2. 新版软件不拆稿、不默认编导演指令、不替用户挑试演。Window 和 anchor 全部来自已确认 Plan。普通配音模块继续独立存在。
3. Patch 只修改列明的 Window 参数；拆分、合并、换音色、改原稿、换引擎、改锚点结构必须新建 Plan Revision。原稿默认锁定。
4. 首版 anchor 引用完整 Window，数量不限于三个；不做软件截取某几句话。牺牲少量试演费用，换取试演与正式生成相同上下文和可复用音频。
5. 保留每次生成的旧音频；“删除版本”首版实现为隐藏/软删除。选中版本、Golden及诊断引用的版本不能删除，暂不提供物理清理。
6. 不把 E0 或“模型接收参数”解释为真人听感保证。精确400ms请求成立，但最终可听停顿可能包含模型自然停顿；需要输出级精确静默时，由明确的本地 transition 插入完成。
7. 候选 SSML 包含 break、phoneme、say-as、sub 的结构化编译；并列 speak 范围 rate/pitch 属官方支持，但纳入首版协议候选，先执行用户批准的Capability Spike再决定启用，绝不写成模型不支持。

决定效果的关键变量是：样本声音是否适合出镜讲话、Instruction能否抓住人物状态、Window是否保留完整意思、用户是否基于真实WAV作选择。增加协议字段本身不能产生“活人感”。第一轮优先用已确认开场/价格/CTA做少量对照，听感没有改善则重新审视声音样本和导演表达，不继续堆参数。

## 交付索引

| 文件 | 内容 |
|---|---|
| [01-源码审计与重构边界.md](01-源码审计与重构边界.md) | 当前基线、删除/保留/重构、代码证据与风险 |
| [02-官方能力核验.md](02-官方能力核验.md) | 地域、参数、SSML、复刻、HTTP/WS区别、官方来源 |
| [COSYVOICE_CAPABILITY_PROFILE.v1.json](COSYVOICE_CAPABILITY_PROFILE.v1.json) | 唯一机器能力真值草案 |
| [03-ChatGPT真人口播导演意图沟通手册.md](03-ChatGPT真人口播导演意图沟通手册.md) | 普通用户用语、词典、问题与能力边界 |
| [04-真人带货口播台词需求模板与示例.md](04-真人带货口播台词需求模板与示例.md) | 可复制模板、完整示例、导演确认稿 |
| [05-ChatGPT到CosyVoice执行协议编译规范.md](05-ChatGPT到CosyVoice执行协议编译规范.md) | 编译、哈希、语义校验、Patch原子性 |
| [schemas/common.schema.json](schemas/common.schema.json) | 严格公共定义 |
| [schemas/REAL_SPEECH_EXECUTION_PLAN_V2.schema.json](schemas/REAL_SPEECH_EXECUTION_PLAN_V2.schema.json) | Plan JSON Schema 2020-12 |
| [schemas/REAL_SPEECH_EXECUTION_PATCH_V2.schema.json](schemas/REAL_SPEECH_EXECUTION_PATCH_V2.schema.json) | Patch JSON Schema 2020-12 |
| [examples/plan.json](examples/plan.json)、[examples/patch.json](examples/patch.json) | 相互绑定的结构示例，不是听感合格样片 |
| [06-架构UI数据迁移与测试.md](06-架构UI数据迁移与测试.md) | 模块、工作流、存储、迁移、回归与验收 |
| [07-设计交付验证.md](07-设计交付验证.md) | 本次实际验证结果与未验证项 |
| [08-独立文档查看器设计.md](08-独立文档查看器设计.md) | 新增要求：独立Electron窗口、固定工具栏、全文复制、多实例、生命周期、安全、Win10/11验收 |

覆盖用户要求的14项：审计及删留在01；官方表在02；Manifest独立JSON；三份文档03/04/05；两份Schema独立文件；UI、迁移、风险、测试在06。

新增文档查看器要求全部在08：采用无parent、非模态顶层BrowserWindow；不同文档并开、同文档复用；正文独立滚动，顶部工具栏永久可见；从文档原始snapshot异步复制全文；关闭/退出/托盘与主任务明确分离。此项也属于待确认设计，没有提前修改UI源码。

## 版本与文档体系

全包统一引用 `capabilityProfileId=aliyun.cosyvoice-v3.5-plus.cn-beijing.http`、`capabilityVersion=1.0.0-draft.2`。三份文档不另写一套常量；能力数值只以 Manifest 为真值，02是其审查依据。

这是一份尚未接入软件的V1能力草案。正式批准后移至专用 capability registry，三份文档在构建时注入同一profile header；锁文件记录文档、schema、manifest SHA-256。运行时加载内置受信profile，导入JSON不能自行扩大能力。旧profile永久保留用于历史快照，不对旧请求套用新规则。

ChatGPT必须获得Manifest与对应文档后才能编译。若附件读取失败或缺失，先索取缺失文件，不凭模型记忆编造能力。旧正式文档仍维持修复版2的现有构建，待批准的实现阶段再整体替换镜像和检查脚本，避免本轮设计污染可构建基线。

下一阶段只能在明确确认后开始。本包没有开始V2实现，也没有承诺模型能保证销量或声音效果。


## R2评审入口与当前关卡

本包尚未冻结。先阅读[10-R1到R2修改清单.md](10-R1到R2修改清单.md)及[09-CosyVoice-3.5-Plus-Capability-Spike方案.md](09-CosyVoice-3.5-Plus-Capability-Spike方案.md)。完整逐行Diff在review/R1-to-R2.diff，原R1包保留。

顺序：第二次设计确认 → 单独付费Spike批准 → 隔离验证与报告 → 启用决策 → Profile/Plan/Patch共同冻结 → 另行授权正式开发。当前没有付费API调用，没有运行源码修改。

正常导入不要求导演稿附件；本地明确确认Plan来源即可。intentRanges只展示，不参与参数推导。03已扩展为可用Ctrl+F查词的完整词典。spike目录保存离线请求样例、测试矩阵和NOT_RUN结果模板，不包含自动调度调用脚本。

# 真人口播生产规则｜R3

协议2.1；Capability Profile 1.0.0-draft.3。依据：黄明昊修正版 + cosyvoice-v3.5-plus + 北京地域，第一批15次云端请求及老唐人工试听。范围有限，不能外推所有音色。官方支持事实与本产品推荐分开；不以听感不好推断模型不支持。

## Naturalness First / 最小干预

优先顺序：原始连续文本与模型自然生成 → 经确认的标点/文本结构或一个极短状态 → 必要SSML结构 → 确有读错时的phoneme/hot_fix/sub/say-as → 用户明确实验的rate/pitch/多speak。不是每次依次叠满；基线较自然就保留。软件不改台词、不拆Window、不读取导演文字推参数。

每增加一个控制层，必须证明带来听感收益；“更精细”不构成收益。Window切分也可能造成接缝，不把Window边界当无风险表演工具。

| 复杂度 | 明确执行字段 | 生产规则 |
|---|---|---|
| L0 | 连续纯文本、默认参数 | 首选；仍可能平读，并非保证自然 |
| L1 | 一个极短状态或单一结构/纠音控制 | 默认可用，必要时试听 |
| L2 | instruction+单一SSML；两类控制 | controlReason必填，说明听感收益并验证 |
| L3 | 多speak、非默认rate/pitch/volume、长指令或三层以上控制 | HIGH；experimental=true并在软件单独明确确认，禁止默认自动编译 |

instruction默认空；需要时加权建议≤20（汉字计2、其他码点计1），只表达一个核心状态。这是保守PRODUCT_RECOMMENDED_RANGE，不是官方限额，也未证明为最佳阈值。官方MODEL_HARD_LIMIT仍为100。20以上为PRODUCT_DISCOURAGED；仅显式实验允许，软件不截断、不改写。软件核对instructionIntentCount=0/1，但不会解析句子判断是否真正单一状态，语义质量仍由导演和用户核对。

break按语义使用，优先短停顿，建议80–200ms作为初始产品假设，非最优实测范围。400ms不是常用模板。E0是明确结构，不是实际总间隙严格等于数值；自然停顿可能叠入。每个break必须人工验证自然度，超建议值应说明理由。

“激情→pitch升高、更快→rate升高、爆点→volume升高”禁止自动映射；这些默认是DIRECTOR INTENT。数字怎么卖与数字怎么读分开。sub仅文本别名，say-as仅读法，phoneme仅纠音，不能承担情绪/节奏/销售感；hot_fix未测试，暂不执行。

## 现有操作说明（能力启用状态以本页上方及当前Profile为准）

# 听感诊断：软件只打包

选择全篇、单Window或多选Window，填写你实际听到的问题和位置，导出诊断ZIP给ChatGPT。必须听实际WAV；未听到时只能按文本或用户反馈提出假设。

分别看选中音频的真实requestSnapshot和当前配置，不能把新配置误当旧音频的参数。原文、意图、Window范围、音色和profile一起提供。先针对一个主要问题提出修复，明确E0/E1/E2/E3及限制，返回REAL_SPEECH_EXECUTION_PATCH_V2。

Patch必须复制taskId、basePlanId/basePlanHash、targetWindowIds、expectedVersions与lockedWindows；不能猜hash，不能改非目标Window。每个Window至少一个intentRange，展示文字不能被软件用于自行生成参数。

用导演词典Ctrl+F搜索“平读”“句尾”“广告腔”“价格高潮”等。软件没有自动真人感评分，听感观察也不能替代API能力证据。


修复只改一个主要变量。诊断加入发音完成度/口语粗糙度；只保存在意图层，没有硬参数。旧2.0任务安全读取/试听/导出，不自动升级；重新编译2.1并确认新任务后执行。

# 真人口播生产规则｜R3

协议2.1；Capability Profile 1.0.0-draft.3。依据：黄明昊修正版 + cosyvoice-v3.5-plus + 北京地域，第一批15次云端请求及老唐人工试听。范围有限，不能外推所有音色。官方支持事实与本产品推荐分开；不以听感不好推断模型不支持。

# CosyVoice能力与真人口播生产建议

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

## Model Capability与Product Recommendation

| 能力 | 模型事实 | 本产品状态 | 用途/限制 |
|---|---|---|---|
| instruction | MODEL_SUPPORTED | PRODUCT_ENABLED、SHORT_ONLY、SINGLE_INTENT_ONLY | E2；长指令PRODUCT_DISCOURAGED，20以上需实验，不突破官方100 |
| 单speak | MODEL_SUPPORTED | PRODUCT_ENABLED | E0结构载体，不保证活人感收益 |
| break | MODEL_SUPPORTED | PRODUCT_ENABLED | E0结构；NATURALNESS_VALIDATION_REQUIRED，不模板化400ms |
| 多speak | MODEL_SUPPORTED | PRODUCT_DISABLED_BY_DEFAULT | 拼接/能量断裂风险，用户显式实验可用 |
| 局部rate/pitch | MODEL_SUPPORTED | PRODUCT_DISABLED_BY_DEFAULT_FOR_PERFORMANCE | E1参数，不自动代表销售节奏/激情/重音 |
| sub | MODEL_SUPPORTED | PRODUCT_ENABLED_FOR_TEXT_ONLY | E0别名；本例与基线PCM一致，未区分验证 |
| say-as | MODEL_SUPPORTED | PRODUCT_ENABLED_FOR_READING_ONLY | E0读法，有异常风险，不做数字爆点 |
| phoneme | MODEL_SUPPORTED | PRODUCT_ENABLED_FOR_PRONUNCIATION_ONLY | E0纠音，不控制情绪/节奏/销售力 |
| seed | MODEL_SUPPORTED | PRODUCT_ENABLED_FOR_REPRODUCIBILITY | E1；本批两次PCM一致，不跨版本保证，不提升自然度 |
| hot_fix | MODEL_SUPPORTED | PRODUCT_DISABLED_PENDING_VALIDATION | 未测；不顺带启用 |

全局rate/pitch/volume本批只验证默认1/1/50；非默认只能L3实验，并保留范围未验证事实。局部volume和连续speak+instruction未测，仍阻断。E3指没有精确执行保证，不把主观不好听改成MODEL_UNSUPPORTED。

第一批人工反馈为一个音色的有限经验：纯基线相对自然但仍平读，短instruction可能表演过度，长instruction播音腔，控制叠加更做作，多speak拼接/状态断裂，局部rate/pitch增加AI感。启用结构/读法能力不等于承诺效果。

技术记录：15个HTTP200、729计费字符、用量计价0.10935元；实际账户扣款未核验。Case04只本地拦截。所有原始文件永久保留，不再调用第二批。

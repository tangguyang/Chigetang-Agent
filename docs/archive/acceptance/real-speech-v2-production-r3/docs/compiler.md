# 真人口播生产规则｜R3

协议2.1；Capability Profile 1.0.0-draft.3。依据：黄明昊修正版 + cosyvoice-v3.5-plus + 北京地域，第一批15次云端请求及老唐人工试听。范围有限，不能外推所有音色。官方支持事实与本产品推荐分开；不以听感不好推断模型不支持。

# ChatGPT → CosyVoice执行协议编译规范

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

## 编译流程

1. 读取本版Profile及Schema，确认原稿和导演意图。directorReference附件可选，正常工作流为任务名称→复刻音色→粘贴Plan→导入并校验；不额外要求上传导演稿。
2. 先编译L0基线；若已较自然，不增加控制。文本、标点、Window边界变化均要用户确认，连续表达优先；一个窗口一个连续意图，不机械拆每句。
3. 把请求区分DIRECTOR INTENT与明确硬参数实验。“更激情、更快、更有爆点”默认意图；确需实验必须用户明确授权，不能自作主张。
4. E0仅结构/读法，E1明确参数，E2语义近似，E3无精确接口；把不能实现的局部销售意图记在intentRanges/未解决项，别硬造参数假装落实。
5. 每Window明确controlComplexity、naturalnessRisk、experimental、controlReason、instructionIntentCount。模型支持与产品规则都校验；L3不得自动生成，除非用户明确实验。Plan里的experimental=true不能替代软件中的独立用户确认。
6. intentRanges只用于阅读、解释、诊断；新增pronunciationCompletenessIntent也只展示。真正执行只来自execution、ssml、hotFix、transition。请求构建器禁止读取意图文字。
7. 输出唯一符合Schema的Plan JSON；不得混入密钥、账户endpoint、任意XML或未知参数。

## 复杂度一致性

软件只按明确参数计算复杂度，不“自行导演”。非默认全局rate/pitch/volume也为L3，因为本批没有验证它们的生产自然度；seed不是表演控制层。instruction或SSML节点至少MEDIUM；L3固定HIGH。L2、L3、任何实验必须controlReason非空。超过产品推荐的长instruction属于L3实验，官方加权超过100仍绝对拒绝。

一个不带节点的单根speak是结构载体，不称提升活人感。一个单speakSegments且默认参数不是多speak；两个以上为L3。三种SSML节点或三层以上控制为L3。instruction+SSML至少L2；两类节点或两个控制组至少L2。默认空instruction时instructionIntentCount=0，否则1。这个计数是编译声明，不是软件的语义判读。

## 文本与确定性序列化

Window.original原稿锁定；synthesisText不同须textApproval明确原因与用户确认。位置按Unicode码点、左闭右开计算。ssml使用enabled/nodes/speakSegments，禁任意XML/DTD/脚本/未知标签；软件仅按明确节点序列化和转义。

节点必须声明固定purpose：break=SEMANTIC_PAUSE、phoneme=PRONUNCIATION_CORRECTION、sayAs=READING_CORRECTION、sub=TEXT_CORRECTION；不能声明EMOTION/SALES。允许break(offset,timeMs)、phoneme(start,end,text,alphabet,ph)、sayAs(start,end,text,interpretAs)、sub(start,end,text,alias,confirmation)。文本切片必须一致，范围不得重叠，节点不得跨speak边界。单根speak为空segments；多段segments连续覆盖全部文本，各段明确rate/pitch/volume，不嵌套。

sub只做文本别名且明确确认；say-as只处理读法；phoneme只纠音。phoneme py=拼音声调编号，cmu支持事实保留但未实测。hot_fix支持事实保留，但NOT_RUN，不因本次用户喜欢phoneme而顺带启用。pronunciation只是镜像，不可二次应用；替换源重复/链式/节点冲突拒绝。不得用这些工具制造情绪、重音、销售力。

同边界不叠break与transition，不自动裁静音、交叉淡化或换音色。原始WAV及所有版本永久保留，参数正确也不保证听感自然。

## Plan字段与示例

protocolVersion=2.1，capabilityVersion=1.0.0-draft.3。当前运行Schema位于resources/real-speech-v2/schemas，本目录有同步副本。示例位于examples；plan.json保留单一短状态演示，plan-l0-baseline.json演示首选纯文本。多speak示例明确experimental，禁止复制为默认生产模板。

originalTextHash可首次null，由软件计算；提供错误hash则拒绝。SHA256基于原样UTF8；planHash用确定性JCS排序，拒重复键、无效Unicode/非有限数值。不要让ChatGPT手算。导入时保存本地确认记录和Profile内容hash；历史2.0/draft.2任务可读取、试听、诊断，不自动升级执行或改音频，需重新编译并确认2.1新任务。

## Patch：一个主要变量

必须changeIsolationPolicy=ONE_PRIMARY_VARIABLE_AT_A_TIME。一次整份Patch最多改变一个主要变量族，多个目标Window也遵守。不是只数set键；ssml内break、phoneme、sub、sayAs、speak结构、局部rate、局部pitch、局部volume是不同变量；hotFix.pronunciation与hotFix.replace也分别比较。启用SSML外壳只承载一种节点时与该节点算同一变量；pronunciation镜像、textApproval、E级解释和风险标签是辅助说明，不是新的声学变量。

允许步骤：先只改instruction→生成新版本→试听→仍不满意再只改break。禁止instruction+rate+pitch+break+speak一把改。若还需改复杂度/风险，ChatGPT明确提供对应元数据，软件只校验，不自动补参数或风险标签。

Patch带真实taskId、basePlanId/hash、expectedVersions、targetWindowIds、lockedWindows；软件预览实际Diff再由用户确认，只改目标，不能改锁或非目标。L3/experimental修复必须额外确认风险；不是初次勾选后永久授权任意参数。display-only Patch不建生成job，明确execution变化才追加音频版本，永不覆盖旧版本。

## 证据与边界

Case01/05解码PCM一致，但用户主观认为05稍慢；同时保留，不伪造客观差异。Case11/12/16 PCM一致，接口接受不代表读法控制已区分验证。Case02/14 PCM一致只证明本批两次复现，seed不是自然度按钮。Case04只有本地101拦截，不能记成云端拒绝测试。

本轮产品允许sub/say-as/phoneme的限定用途，是用户生产启用决定，不是模型全部读法/发音范围验证。多speak和局部rate/pitch继续MODEL_SUPPORTED，PRODUCT_DISABLED_BY_DEFAULT；明确实验用户可用，未测hot_fix/局部volume仍阻断；连续speak+instruction组合NOT_RUN，仅明确L3实验允许，不能标为已验证。

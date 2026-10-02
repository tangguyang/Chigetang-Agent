# ChatGPT → CosyVoice执行协议编译规范｜V2设计稿

schema版本：2.0。profile：`aliyun.cosyvoice-v3.5-plus.cn-beijing.http@1.0.0-draft.1`。输入必须为用户确认的导演稿＋Manifest＋原稿。输出严格遵守本目录schemas；本规范同时负责Schema无法表达的语义规则。

## 编译顺序与能力分类

1. 检查当前会话读取了Manifest，版本与三份文档一致；确认导演稿有明确用户确认，原文没有擅改。
2. 按原稿顺序提取Window及directorReference，不机械按标点再拆段。推荐以一个完整意图连续表达为单位，结构必须用户确认。
3. 逐项判为E0 EXACT_STRUCTURAL、E1 PARAMETER_CONTROLLED、E2 SEMANTIC_CONTROLLED或E3 UNSUPPORTED。
4. E0用真实break/读法/文字映射；E1用真实rate/pitch/volume/seed；E2压缩到短Instruction；E3经确认后记录近似及原始要求，否则unresolved。严禁发明wordEmotion/pitchCurve/salesPressure字段。
5. 生成合成纯文本及明确的读法Diff，生成受控SSML节点；完成官方和产品规则校验。
6. 输出唯一Plan JSON。不能混入多个协议或额外解释字段；人类说明另发。PlanId、WindowId、anchorId用简单稳定的本地标识，不凭空猜软件taskId。

| 导演需求 | 编译方式 | 可信度/边界 |
|---|---|---|
| “这里停400ms” | ssml break节点，offset指纯文本码点位置 | E0指定插入；最终可听间隙可能含自然停顿 |
| “整句话稍快” | 已确认该句为完整Window则rate；否则Instruction近似或重新确认结构 | E1整体参数；不暗中拆句 |
| “带一点调侃” | instruction：“像熟人聊天，带一点会心笑意，别夸张。” | E2，无emotion数值 |
| “某一个字pitch +8%” | 无逐字精准声学接口，E3。用户接受可用Instruction强调或另建范围/Window整体参数 | 范围控制是近似，需确认；首版不开放多speak范围 |
| “这个数字正确朗读” | cardinal/digits等say-as；格式不匹配时用确认的synthesisText转换 | E0读法结构；不要给整数自动套currency |
| “这个词发音错误” | 一个位置用phoneme py/cmu；全窗口一致读法用hotFix.pronunciation | E0；pronunciation不能直接当官方input字段 |

executionConfidence数组逐项记录 intentId、需求、capability、E级、实现方式、目标路径和近似确认。不用单一“最高等级”掩盖E2。E3原要求仍保留，采用的E2近似另记录。不存在的官方能力按Manifest禁止；模型支持但产品未开放也拒绝，错误类型不同。

## 指令编译

Instruction优先包含人物关系/本窗口最关键动作/一个禁止项，例如“像熟人面对手机解释，中段自然连说，句尾收稳，不播音。”不要同时塞八种矛盾情绪。不按每句硬塞重音，不自动添加口误、喘息或承诺事实。

加权校验按Unicode码点遍历：Script=Han计2，其余1；不得用JavaScript UTF-16.length把emoji代理对误算成2，不自动trim、规范化、翻译或截断原始instruction。对未明确的罕见组合字符计数属于产品实现解释，云端有冲突则记录证据更新profile。官方加权≤100；产品短指令建议不另变成硬上限。

## 文本、SSML与纠音只有一条权威链

Window.original是原稿连续片段；synthesisText是送入发音标记前的纯文本。二者不同必须textApproval列出原因和用户确认引用。**Original Text锁定不等于合成文本可以偷偷改**，Diff必须展示词/标点/数字读法的变化。

ssml不是原始XML字符串，而是`enabled + nodes`。节点只允许break(offset,timeMs)、phoneme(start,end,text,alphabet,ph)、sayAs(start,end,text,interpretAs)。位置以synthesisText的Unicode码点计，左闭右开。每个节点text必须等于切片；范围不得重叠，break不得落在phoneme/sayAs内部。节点按位置顺序，不允许DTD、实体声明、未知标签、外部声音/BGM或更换voice属性。

软件只能**确定性序列化已经指定的节点**为官方SSML；这不是导演编译。text必须XML转义，统一外包一个speak。enabled=false则nodes为空；有nodes则enabled=true。break遵守Manifest模型范围；相邻break总和不得超上限，不让服务端静默截断。首版不允许任意XML、prosody、emphasis或多speak范围；这是PRODUCT_HARD_LIMIT，不是MODEL_HARD_LIMIT。

pronunciation条目只给method=phoneme的区间说明，必须与对应节点完全一致；method=hotFix仅镜像hotFix.pronunciation。它是供人核对的非执行声明，绝不第二次应用。hotFix在已指定节点文本上可能产生覆盖冲突时拒绝；replace源须真实出现在synthesisText，重复出现会影响全窗口，必须明确确认。所有replace的预期实际朗读文本展示在预览；不允许链式/循环替换和替换XML标签。台词原稿不会被hotFix覆盖。

同一边界只能一种额外静默：窗口尾部break与transition.pauseMs>0冲突；首版也拒绝下一个窗口开头break与前transition双加。transition由Plan明确指定，本地插入静默只保证插入样本数，不保证两侧TTS自然静默消失。没有用户确认不能自动裁两端静音或交叉淡化。

## Hash与确认记录（防止ChatGPT手算Hash）

originalTextHash=SHA-256(UTF-8原样originalText)；保留换行、空格、标点、Unicode，不做NFC/CRLF转换。文件hash=SHA-256原始字节。planHash=SHA-256(RFC8785规范化整个Plan JSON)；导演稿hash=SHA-256确认文件UTF-8原样正文，建议正文不含自身hash。

JSON Schema只校验hex格式，不能证明内容正确。禁止要求语言模型心算hash。首次编译可将originalTextHash和directorReference.documentHash置null（未绑定草案）；软件导入校验时计算并展示绑定结果，用户“保存执行方案”后生成填有真实hash的冻结Plan及planHash。**null草案不得生成**。提供了hash则必须匹配，不自动纠正不一致。最终导出Plan给ChatGPT用真实hash，Patch必须原样复制诊断包里的绑定值。

采用[RFC8785 JCS](https://www.rfc-editor.org/rfc/rfc8785)的确定性属性排序与ECMAScript数值序列化；拒绝重复键、无效Unicode与非有限数值。旧domain canonical使用localeCompare，不直接沿用作跨环境新协议哈希。Schema参考[JSON Schema 2020-12验证规范](https://json-schema.org/draft/2020-12/json-schema-validation)；跨字段集合、真实hash、官方范围及文本覆盖仍须语义验证。

首次Plan无需软件taskId，软件创建时分配；directorReference.confirmation记录导演稿ID/version/明确确认语句，由用户导入时再次确认对应内容。此记录是用户声明的确认轨迹，不是密码学身份认证。导演稿附件缺失且documentHash=null时，必须附确认稿完成绑定，不伪造审核完成。

Schema底层只约束类型，不在JSON Schema中复制官方参数范围；范围全部由Manifest validator校验。发布时生成范围视图并标注profile hash，防止第二套真值。

## Plan语义校验必需项

- profile ID/version存在且受信；engine model/region/transport与profile匹配；voice requirements为复刻且targetModel匹配；本地选择的voice与账号/Workspace一致，API Key和endpoint不从Plan读。
- protocolVersion=2.0，未知字段在每层拒绝，JSON重复键拒绝，NaN/Infinity拒绝，单协议、体积符合产品保护。
- windows非空；id唯一；offset连续覆盖originalText码点0到末尾，original逐字等于切片，不能错序、重叠、漏字；不重拆。
- 所有anchor引用真实Window。首版同一个anchor只引用一个完整Window；多个anchor可引用同Window、focus不同，测试结果以参数binding复用；空anchor列表允许，须导演确认不做试演。
- directorReference块引用有效且已确认；textApproval涉及的替代已获确认。
- confidence.capability存在；E级不能把instruction标E0；每个要求的路径存在且属于本Window。nearby constraints不自动变成API字段。
- unresolved须真实列出Window和处理；未确认E3阻止所影响Window生成，空windowIds视为全局阻止。其他无关Window可单独生成；全篇拼接与Golden需所有阻断清除。
- lockedFields采用规范JSON路径并解析实际字段；originalText、hash、engine、voiceRequirements和窗口边界为结构锁，普通编辑不能解锁。窗口用户锁/Golden引用由运行时加严。

## Patch规则与Diff

Patch包含patchId/basePlanId/basePlanHash/taskId、capability ID/version、targetWindowIds、expectedVersions、changes、lockedWindows、diagnosis、validationFocus。changes只有windowId和typed set，可改instruction/rate/pitch/volume/seed、synthesisText及配套textApproval、SSML/pronunciation/hotFix、transition；不接受任意JSON Pointer操作。不含原稿/边界/engine/voice/anchors更新，不含软件自定修复action。

expectedVersions逐目标包含配置configRevision及当前selectedVersionId/selectedVersionHash。以配置修订防用户手改，用音频ID/hash防选中版本已变；没有音频可null/null。软件检查target集合与expected集合完全相等，changes不越权且每目标至少一项真实变化；lockedWindows不能与targets交集，真实锁集合必须与包声明一致。Patch不能靠不声明锁解锁。

basePlanHash绑定当前冻结Plan。Patch应用产生新的Plan Revision（新planId、parentPlanId旧planId、新hash），属于局部修订，不要求ChatGPT重交全文。结构改变才由ChatGPT提交新完整Plan。前一个Patch完成后旧baseHash失效；首版严格拒绝并行陈旧Patch，不自动rebase。

过程：只读校验 → 展示字段级Diff、受影响Window、预计重新生成范围及不变范围 → 用户点击“应用并生成新版本” → 事务内再次检查base/versions/locks → 保存新PlanRevision＋Patch记录＋唯一generation job → 提交后顺序调用目标Window TTS。云端请求不能在SQLite事务里等待。

DB应用成功但TTS失败：新配置和失败job保留，旧选中音频仍在，界面显示新配置尚未有成功版本；不回滚历史，不假称生成完成，不自动重发unknown请求。重启后durable job和请求快照恢复。patchId重复点击返回原job状态，不创建新付费任务。

普通人工参数编辑走相同revision/Diff/校验服务，用户保存后创建新修订；“切换选中音频”仅改变选中指针。要恢复旧参数必须单独点击“从该版本恢复配置”，形成新revision，不能默默改写草稿。

## 诊断编译与验收

实际诊断包必须区分current frozen Plan、当前配置草稿、选中音频实际request snapshot、历史元数据。ChatGPT不能把现在rate误当作旧WAV使用的rate。只诊断选中的全文/单段/多段；非target窗口只能列观察，不能改。

diagnosis.evidenceBasis为audio_listened/user_feedback_only/text_only；audio_listened必须实际读到对应WAV，记录listenedVersionIds。无声音不得假称听感确定。validationFocus描述重听具体位置和目标，例如“99元是否自然清楚，CTA是否延续人物状态”，不编造自动合格分。

示例JSON是结构演示，真实hash由本次设计验证生成；示例Patch只改GW002，不改变GW001/GW003。软件尚未实现这些schema，不能把本设计样例直接当作修复版2协议导入。

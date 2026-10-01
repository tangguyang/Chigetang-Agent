# CosyVoice 3.5 Plus官方能力核验

核验日期：2026-10-01。证据等级：官方文档核验；无本轮真实云端调用。profile：`aliyun.cosyvoice-v3.5-plus.cn-beijing.http@1.0.0-draft.2`。

## 官方来源索引

| ID | 官方页面 | 本次核对部分 |
|---|---|---|
| S1 | [非实时语音合成CosyVoice HTTP API](https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api) | 地址、input字段、范围、响应、hot_fix |
| S2 | [非实时语音合成](https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide) | v3.5 instruction自由指令、加权规则、地域 |
| S3 | [SSML与LaTeX](https://help.aliyun.com/zh/model-studio/ssml-latex-user-guide) | 使用限制、speak/break/phoneme/say-as |
| S4 | [声音复刻](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide) | CosyVoice样本要求、地域、target_model |
| S5 | [声音复刻HTTP API](https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api) | voice-enrollment、prefix、预处理字段 |
| S6 | [CosyVoice客户端事件](https://help.aliyun.com/zh/model-studio/cosyvoice-client-events) | WebSocket范围与SSML单次continue限制 |
| S7 | [cosyvoice-v3.5-plus模型页](https://help.aliyun.com/en/model-studio/cosyvoice-v3-5-plus) | 模型身份、北京、模型描述 |

所有事实为上述页面在核验日的内容；后续官方变更应生成新profile版本，不覆盖旧快照。页面通用描述不能直接证明某模型的每项能力。SDK代码注释含旧模型列表，采用当前明确使用限制列表；官方SSML示例也出现与其参数表范围不一致的旧写法（如rate=-500），不复制旧例，按当前表校验并在云端验收。

## 官方硬限制与真实控制

| 能力 | 核验结论（MODEL_HARD_LIMIT/支持条件） | 可信度与产品处理 | 来源 |
|---|---|---|---|
| model / region | cosyvoice-v3.5-plus，目前北京；无系统音色 | E0路由选择；仅复刻音色进入本产品 | S2/S3/S7 |
| instruction | 自由自然语言；加权≤100。Han按2，其余字符按1；涵盖日/韩汉字 | E2，控制方言/角色/情绪；不保证重点落点。产品取消Han40硬限制 | S2 |
| rate | 0.5–2，默认1，作用于请求文本 | E1，不是每秒字数/目标总时长 | S1 |
| pitch | 0.5–2，默认1 | E1，不是Hz曲线，也不保证人物连续性 | S1 |
| volume | 整数0–100，默认50 | E1，不是dB/LUFS目标 | S1 |
| seed | 整数0–65535，默认0；相同模型版本及完整输入时官方描述可复现 | E1，不是质量/情绪参数。保存实际请求；云服务版本未锁定时不作跨时间字节保证 | S1 |
| sample_rate | HTTP：8000/12000/16000/22050/24000/44100/48000 | E0输出格式结构；产品使用48000 | S1 |
| format | HTTP支持mp3/pcm/wav/opus | 产品固定wav，实际编码/声道用本地校验；不把本地PCM校验要求冒充API新参数 | S1 |
| language_hints | 数组仅第一项有效；HTTP列出16个语言值 | E1；产品建议单值zh。参数枚举不是模型每种语言同等质量证明 | S1 |
| SSML | v3.5-plus复刻音色支持HTTP enable_ssml=true | E0标签结构；只开放受控节点，不接任意XML | S3 |
| break | ms整数50–10000；s整数1–10；无time默认1s；连续break累加截到10s | E0插入静默请求；可听总间隙含自然停顿。拒绝让云端静默截断 | S3 |
| phoneme | py拼音、cmu英文音标；标签内纯文本 | E0发音标注，最终发音需试听；py音节数量需对应汉字 | S3 |
| say-as | cardinal/digits/telephone/name/address/id/characters/punctuation/date/time/currency/measure | E0解释类型；先匹配类型合法输入，价格可用cardinal标数字保留外部“元” | S3 |
| hot_fix | pronunciation词→拼音；replace词→替代文本，合成前作用 | E0文本/发音映射，区别原稿和实际合成内容 | S1 |
| pronunciation | 非顶层官方字段；产品抽象映射phoneme或hot_fix.pronunciation | 同一词同一范围只选一路，避免双重纠音 | S1/S3 |
| HTTP API | Workspace北京域名 /api/v1/services/audio/tts/SpeechSynthesizer；body={model,input}；非流式音频URL约24h | E0传输；保存响应并立即下载；过期恢复不能自动再付费 | S1 |
| 字级时间戳 | 复刻音色支持，但仅流式输出 | 是输出观察能力，不是逐字控制；首版非流式不可用 | S1 |

S1对HTTP text没有在当前页面明确给出长度硬上限；不得把S6的单次20000/累计200000字符搬作HTTP官方硬限制。首版单Window纯文本与生成后的SSML字符串各≤20000 Unicode码点，**PRODUCT_HARD_LIMIT**，待真实接口验收再调整。Plan导入体积≤1MiB、Window/anchor数量≤500也都是本地资源保护，不是模型限额。

**transport差异**：S6的sample_rate未列12000，S1 HTTP列12000；HTTP bit_rate只在opus生效，WS说明覆盖mp3/opus。当前首版wav不发送bit_rate；Manifest分别记录transport范围，不求一个虚假的统一枚举。WS enable_ssml=true只允许一次continue-task，不影响本产品HTTP实现。

## 声音复刻与Voice Enrollment

S4 CosyVoice样本：WAV16bit/MP3/M4A；≤10MB；≤60秒，推荐10–20秒；≥16kHz；单/双声道，双声道仅首声道；至少5秒连续清晰讲话，短暂停顿≤2秒；正常语速，无背景音乐/其他人声。官方推荐时长不是产品必达硬门禁。

S5：北京 customization endpoint；model=voice-enrollment、action=create_voice、target_model必须与合成模型一致、url公网可访问，prefix仅英数字且≤10字符。max_prompt_audio_length为预处理后实际取样最大时长，3–30秒，默认10；它与上传样本≤60秒不是同一限制。enable_preprocess布尔默认false；enable_volume_normalization官方是字符串"true"/"false"；不得与合成volume混用。新口播只选择已有可用复刻音色，复刻管理基础模块保留。

## 不能精确实现与近似途径

| 要求 | 事实/推断分类 | 处理 |
|---|---|---|
| 逐字连续rate/pitch曲线、某字精确F0+8% | 当前已核验API未提供此类接口，按E3处理 | 禁止wordPitch等假字段；如用户接受，可用独立范围或Window整体pitch/Instruction近似 |
| 局部范围快慢/音高 | S3支持并列speak各自rate/pitch，非嵌套 | E1范围参数支持；“逐字精准声学变化”仍不成立。首版候选保留，等待Spike决定，Manifest不能写模型不支持 |
| 逐字emotion/emphasis数值 | 未发现独立官方接口，按E3精确要求处理 | Instruction中的重点/调侃等为E2；标明近似获用户确认 |
| 真人状态连续、价格高潮、CTA自然、销售能量曲线 | E2导演意图，非API真实数值 | Instruction与用户确认的Window设计近似；试听判断，禁止软件给自动听感分数 |
| 保证每个字时长、整段精确10秒、逐词时间戳用于控制 | 无相应控制承诺 | E3；时间戳仅观察；不假称可锁时长 |
| [laughing]等富语言标签 | S2列明属于Qwen-Audio系列的功能 | 不能挪用到CosyVoice3.5-plus；首版拒绝这类标签 |
| prosody/emphasis标准SSML标签 | 本次核验的官方标签集合未列这些控制接口 | 不因W3C支持就开放；要使用必须重新核官方profile |

E3是“当前证据下不作为可执行控制”，不是推论模型永远没有能力。模型大概率理解“轻微调侃”，不等于每次都成功或可以标成EXACT。

## 产品范围（建议值不是效果证据）

PRODUCT_RECOMMENDED_RANGE：初次rate 0.9–1.1、pitch优先1、volume优先50、seed先0；instruction建议加权≤80，保留修改余量，不做硬拦截；只给关键语义停顿添加break。以上为本产品初始调试建议，没有实测最优依据；超出建议但在官方范围内应提示并允许。

PRODUCT_HARD_LIMIT：首版wav/48000Hz；单languageHints；不接原始XML；候选Schema包含break/phoneme/say-as/sub与并列speak参数；正式启用集合待Spike决定；每个边界仅SSML或transition一种额外停顿。全部需在profile.productPolicy明确声明，与modelCapabilities分开。


## R2补核与能力真值

官方SSML明确支持sub(alias替代朗读)、连续非嵌套speak及speak级rate/pitch/volume。不能用产品暂不开启覆盖模型能力真值。[官方SSML说明](https://help.aliyun.com/zh/model-studio/ssml-latex-user-guide)。Manifest分别存modelSupport=MODEL_SUPPORTED与productPolicy.capabilityAvailability；后者为PRODUCT_ENABLED、PRODUCT_DISABLED_PENDING_VALIDATION、PRODUCT_DISABLED_OUT_OF_SCOPE或PRODUCT_UNSUPPORTED。PRODUCT_ENABLED在本设计稿只表示产品候选规则允许，不表示软件已实现或云端已实测。所有Spike结果目前NOT_RUN。

官方文档中的历史示例、HTTP/其他接口参数命名和数值口径不可混用；实际优先级、字符边界、指令与SSML组合必须按09实测，失败不能直接抹掉官方支持项。

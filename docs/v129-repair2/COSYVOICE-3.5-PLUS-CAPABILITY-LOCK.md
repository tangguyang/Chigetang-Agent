# CosyVoice 3.5 Plus 能力锁｜v1.2.9 修复版2

核验日期：2026-10-01。目标模型固定为 `cosyvoice-v3.5-plus`。

本文件是“真人口播”执行层的能力白名单。代码、协议、UI 不得自行扩展模型不存在的参数。

## 官方执行能力

- `instruction`：复刻/设计音色支持自由指令；服务端长度上限为 100 个加权字符。汉字按 2，其他字符按 1。
- 项目额外安全门槛：Han <= 40；这是吃个糖项目上限，不冒充官方上限。
- `rate`：[0.5, 2.0]，默认 1.0。
- `pitch`：[0.5, 2.0]，默认 1.0。
- `volume`：[0, 100]，默认 50。
- `seed`：[0, 65535]，默认 0。
- `format`：本项目固定 `wav`。
- `sample_rate`：本项目固定 48000Hz；官方支持 48000。
- `enable_ssml`：CosyVoice 3.5 Plus 支持 SSML；本项目只开放经过白名单编译的定点停顿，不接受用户任意 XML。
- `hot_fix.pronunciation`：支持指定词拼音纠音；本项目 pronunciation 映射到此能力。
- `word_timestamp_enabled`：克隆音色支持，但仅流式输出可用；当前真人口播非流式生产链不把它伪装成可用的普通参数。

## 项目不允许的假能力

以下只能作为导演元数据，不得直接作为 CosyVoice API 字段发送：

- salesAction
- energy
- salesPressure
- intimacy
- persuasion
- Word Cue 强度值
- “真人感分数”
- 任意自创情绪数值

## 控制原则

1. 优先 `instruction` + 模型自然韵律。
2. `rate/pitch/volume` 只做基础层校准，不做逐字编程。
3. SSML 只修关键失败停顿，不给每个标点机械加 break。
4. 分析可细到词；执行以 Phrase / Generation Window 为单位并尽量连续。
5. 所有参数在发请求前由本地再次校验。

## 官方资料

- 阿里云百炼：CosyVoice 非实时语音合成 HTTP API
  https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api
- 阿里云百炼：非实时语音合成 / Instruction 控制
  https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide
- 阿里云百炼：SSML 与 LaTeX
  https://help.aliyun.com/zh/model-studio/ssml-latex-user-guide
# 第一批 Capability Spike 批准单（未批准、未运行）

目标：确认ChatGPT可以合法给软件下哪些CosyVoice指令，以及如何进入Profile/Plan；不把“活人感”作为API支持与否判据。

模型全部为 `cosyvoice-v3.5-plus`，北京HTTP。所有Case使用同一个用户选定的现有克隆音色；具体voiceRef、remoteVoice、accountId、Workspace尚待配置后只读预检填入，不自动复刻、不虚构音色ID。批准与这些ID及完整矩阵hash绑定。

共16次请求，每Case 1次，无自动重试。第04项为故意超限，放在最后执行；正常预计15份音频，若超限意外被接受最多16份，其他错误会减少数量并停止。02与14完整输入完全一致，只有追踪请求ID不同；只做两次观察，不能推广全局确定性。

官方北京原价为1.5元/万字符（2026-10-01核验）：[模型价格](https://help.aliyun.com/en/model-studio/cosyvoice-v3-5-plus)。以本清单原始正文/XML加instruction共1348个码点粗估约0.2022元，非正式计费报价；XML、instruction和失败请求实际计费以返回usage/控制台及账号价格为准，不含新音色创建（本批禁止创建）。maxCostCny需由你明确填写，不能默认无限预算。用量或计费未知则停止核账。

公共参数：format=wav、sample_rate=48000、rate=1、pitch=1、volume=50、seed=1234、language_hints=[zh]、instruction为空、enable_ssml=false。每Case完整input如下；voice由批准的既有音色注入。

## Case 01：克隆基线/锚点A

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：clonedVoice的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：反问、转折与句尾仅观察。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": false,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "少吃多动，谁不知道？\n问题是——\n你就是坚持不了。"
}
```

## Case 02：instruction/锚点A

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：instruction的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：指令方向，不保证活人感。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": false,
  "language_hints": [
    "zh"
  ],
  "instruction": "像熟人直接提醒，开头轻反问，中间留一下，最后收稳，不责备。",
  "text": "少吃多动，谁不知道？\n问题是——\n你就是坚持不了。"
}
```

## Case 03：instruction加权100边界

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：instruction.limits的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：重复字符不作听感判断。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": false,
  "language_hints": [
    "zh"
  ],
  "instruction": "慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢",
  "text": "少吃多动，谁不知道？\n问题是——\n你就是坚持不了。"
}
```

## Case 04：instruction加权101越界

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：预期4xx；失败也可能计费，预期无音频。

改变Capability Profile的证据：instruction.limits的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：意外接受不自动放宽官方上限。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": false,
  "language_hints": [
    "zh"
  ],
  "instruction": "慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢慢A",
  "text": "少吃多动，谁不知道？\n问题是——\n你就是坚持不了。"
}
```

## Case 05：单speak/锚点A

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：ssml的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：对照01自然静默。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": true,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "<speak>少吃多动，谁不知道？\n问题是——\n你就是坚持不了。</speak>"
}
```

## Case 06：break 400ms

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：break的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：含自然停顿总间隙不等于400ms。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": true,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "<speak>少吃多动，谁不知道？\n<break time=\"400ms\"/>问题是——\n你就是坚持不了。</speak>"
}
```

## Case 07：instruction与SSML同时

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：instruction+ssml的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：对照06状态变化。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": true,
  "language_hints": [
    "zh"
  ],
  "instruction": "像熟人直接提醒，开头轻反问，中间留一下，最后收稳，不责备。",
  "text": "<speak>少吃多动，谁不知道？\n<break time=\"400ms\"/>问题是——\n你就是坚持不了。</speak>"
}
```

## Case 08：连续多个speak同参数/锚点B

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：parallelSpeak的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：对照15的接缝。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": true,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "<speak rate=\"1\" pitch=\"1\">懒宝宝，早上喝。\n</speak><speak rate=\"1\" pitch=\"1\">馋宝宝，中午喝。\n</speak><speak rate=\"1\" pitch=\"1\">又懒、又馋——\n</speak><speak rate=\"1\" pitch=\"1\">一天两杯。</speak>"
}
```

## Case 09：局部speak rate/锚点B

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：speakRangeRate的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：目标短语时长方向及邻段泄漏。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": true,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "<speak rate=\"1\" pitch=\"1\">懒宝宝，早上喝。\n</speak><speak rate=\"1\" pitch=\"1\">馋宝宝，中午喝。\n</speak><speak rate=\"0.85\" pitch=\"1\">又懒、又馋——\n</speak><speak rate=\"1\" pitch=\"1\">一天两杯。</speak>"
}
```

## Case 10：局部speak pitch/锚点B

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：speakRangePitch的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：有声帧F0变化与人物连续性。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": true,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "<speak rate=\"1\" pitch=\"1\">懒宝宝，早上喝。\n</speak><speak rate=\"1\" pitch=\"1\">馋宝宝，中午喝。\n</speak><speak rate=\"1\" pitch=\"1.1\">又懒、又馋——\n</speak><speak rate=\"1\" pitch=\"1\">一天两杯。</speak>"
}
```

## Case 11：sub/锚点C

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：sub的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：alias朗读，广告力度不保证。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": true,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "<speak>专研配方，一杯不到一块钱。\n99块到手<sub alias=\"一百杯\">100杯</sub>。\n每天喝，也不心疼。</speak>"
}
```

## Case 12：say-as/锚点C

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：sayAs的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：读法证据，数字爆点不保证。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": true,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "<speak>专研配方，一杯不到一块钱。\n<say-as interpret-as=\"cardinal\">99</say-as>块到手<say-as interpret-as=\"cardinal\">100</say-as>杯。\n每天喝，也不心疼。</speak>"
}
```

## Case 13：phoneme定点读法/锚点C

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：phoneme的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：样本本来读对不能证明纠错提升。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": true,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "<speak><phoneme alphabet=\"py\" ph=\"zhuan1 yan2\">专研</phoneme>配方，一杯不到一块钱。\n99块到手100杯。\n每天喝，也不心疼。</speak>"
}
```

## Case 14：同seed同完整输入重复02

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：seed的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：PCM/hash/时长差异；仅两次不能推广全局确定性。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": false,
  "language_hints": [
    "zh"
  ],
  "instruction": "像熟人直接提醒，开头轻反问，中间留一下，最后收稳，不责备。",
  "text": "少吃多动，谁不知道？\n问题是——\n你就是坚持不了。"
}
```

## Case 15：真实带货锚点B纯文本

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：clonedVoice的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：短句连续与关系感，仅观察。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": false,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "懒宝宝，早上喝。\n馋宝宝，中午喝。\n又懒、又馋——\n一天两杯。"
}
```

## Case 16：真实带货锚点C纯文本

请求1次，模型cosyvoice-v3.5-plus，同一批准的克隆音色。预期：200并返回可下载音频。

改变Capability Profile的证据：clonedVoice的实际接受/拒绝、方向性/范围生效；成功后仍需用户决定产品启用，不自动修改Manifest。

仅听感观察：价格和收尾；不验证配方和价格事实。

```json
{
  "format": "wav",
  "sample_rate": 48000,
  "rate": 1,
  "pitch": 1,
  "volume": 50,
  "seed": 1234,
  "enable_ssml": false,
  "language_hints": [
    "zh"
  ],
  "instruction": "",
  "text": "专研配方，一杯不到一块钱。\n99块到手100杯。\n每天喝，也不心疼。"
}
```

## 批准前需要填写

现有voiceRef/remoteVoice、账号/Workspace、矩阵hash、选中Case、次数上限、预算上限、当前账号价格、明确批准人和时间。模板为batch1-approval.template.json（approved=false）。真实批准文件应命名为*.spike-approval.json，已被.gitignore排除，不放API Key。设计或开发批准不能替代付费批准。

本轮只运行dry-run和模拟运输测试，真实请求数0。未知提交不自动重发；ledger记录计数和脱敏状态。同一批准hash已启动就禁止重跑。第04项预期拒绝仍需核账，脚本停止后不会补发；若其他Case提前失败，需另批剩余未提交Case。

hot_fix、本地rate/pitch反向与换序、全局/SSML优先级、连续speak配instruction、更丰富say-as及phoneme类型留待后续批次。本批不足以冻结全部能力。

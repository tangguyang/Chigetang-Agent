# R2 → R3 关键修改与Diff

本轮新增云端请求0；不执行第二批；不commit/push。旧设计R1/R2保留原样，当前运行资源和R3评审镜像同步。

| 项目 | 原状态 | 本次变更 |
|---|---|---|
| Profile | draft.2，全控制候选待Spike | draft.3，第一批技术证据与用户试听分开；生产建议独立于模型事实 |
| Plan协议 | 2.0 | 2.1，新增必填controlComplexity/naturalnessRisk/experimental/controlReason/instructionIntentCount |
| instruction | 建议80，未实测启用 | 默认空；单一状态，加权建议20；官方100不变；20以上实验高风险 |
| 多speak/局部rate/pitch | 待Spike | MODEL_SUPPORTED保留；产品默认禁用表演，L3/HIGH明确用户实验允许 |
| break | 待验证 | 结构允许，语义优先、自然度验证，建议短停顿；400ms非模板 |
| 纠音 | 候选 | sub/say-as/phoneme限定纠正用途，节点purpose固定枚举；hot_fix未测继续阻断 |
| 词典 | 32条，有范围参数候选演绎路线 | 36条，每条A–G；所有旧执行路径修订，新增口语粗糙度等4条 |
| 导演意图 | 只展示 | 新增pronunciationCompletenessIntent，仍只展示，绝不发明硬参数 |
| Patch | 多字段自由修复 | changeIsolationPolicy固定；比较实际变量族，一次最多1个主要变量 |
| 实验确认 | 无独立风险确认 | 导入和Patch均有额外checkbox；Plan的true不能替代本地授权；绑定具体配置hash |
| UI/诊断 | 候选能力提示 | 复杂度/风险/实验警示/短指令/读法限定用途/第九维度；诊断ZIP增加production-policy.json |
| 兼容性 | 2.0/draft.2 | 安全读取、旧音频保留、可试听导出；需显式重编2.1新任务，不静默迁移或删除 |

## 关键Schema增量

```json
{
  "protocolVersion": "2.1",
  "capabilityVersion": "1.0.0-draft.3",
  "controlComplexity": "L0 | L1 | L2 | L3（每Window）",
  "naturalnessRisk": "LOW | MEDIUM | HIGH（每Window）",
  "experimental": false,
  "controlReason": "L2/L3、实验或超建议停顿必须说明理由",
  "instructionIntentCount": "0为空；1=单一核心状态，由编译器声明",
  "changeIsolationPolicy": "ONE_PRIMARY_VARIABLE_AT_A_TIME（Patch根）"
}
```

此处为字段说明，不是可导入Plan。真正示例见examples/plan-l0-baseline.json和plan.json。

## Patch不会被一个ssml对象绕过

比较instruction、global rate/pitch/volume、seed、text、break、phoneme、sub、sayAs、speak结构、localRate/localPitch/localVolume、hotFixPronunciation/hotFixReplace、transition。更改同一个ssml对象内的rate+pitch仍算两个变量并拒绝。单一节点所需SSML外壳启用作为辅助结构，不重复算第二变量。

request.ts未修改：仍只读取明确execution/SSML/hotFix，不读意图文字、控制理由或新发音完成度意图。productionPolicy只根据明确字段核对复杂度，不解析导演语义，不补参数、不截断指令。

## 证据边界

用户人工结论逐项原文保留于第一批Spike人工听感结论.md。16项原始记录45份请求/响应/WAV及1份本地拦截共46个文件校验hash不变，位置见evidence/batch1-record-manifest.json。技术数据与主观反馈分开，未上传签名URL或大音频。

Case03是重复字符测试；推荐20不是最优阈值。Case01/05音频相同而用户感到05稍慢，两条证据同时保留。Case11/12/16音频相同，用户读法异常风险结论保留但不能证明标签导致异常。Case04未测试云端101拒绝。seed仅两次同输入证据，不作永久保证。

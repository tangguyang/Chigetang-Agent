# 吃个糖 Agent v1.2.9｜ChatGPT 真人口播返回协议 V1.2

> 工作台顶部 🔒 打开的当前正式协议。
>
> **Runtime Schema 是执行真值；本文是人类可读规范。**

# 1. 版本

```text
PROTOCOL_VERSION = 1.2
CAPABILITIES_VERSION = 1
```

# 2. 唯一两个 Schema

```text
CHATGPT_DIRECTOR_PLAN_V1
CHATGPT_EXECUTION_PLAN_V1
```

软件只执行协议 JSON，不执行自然语言解释。

# 3. 所有计划必填

```json
{
  "schema": "CHATGPT_DIRECTOR_PLAN_V1",
  "protocolVersion": "1.2",
  "capabilitiesVersion": 1,
  "planId": "director-001",
  "taskId": "RS-001",
  "taskRevision": 1,
  "exportId": "EXP-001",
  "contextHash": "软件提供"
}
```

软件另行计算 canonical `planHash`。

# 4. 文本定位

只允许软件提供的 Unit ID：

```text
U001
U002
...
```

禁止自己猜 offset。

# 5. Director Plan 示例

```json
{
  "schema": "CHATGPT_DIRECTOR_PLAN_V1",
  "protocolVersion": "1.2",
  "capabilitiesVersion": 1,
  "planId": "director-case1-r1",
  "taskId": "RS-001",
  "taskRevision": 1,
  "exportId": "EXP-001",
  "contextHash": "abc123",
  "recommendedMode": "DIRECTED_WINDOWS",
  "speakerProfile": {
    "scene": "面对手机镜头自然交流",
    "tone": "直接、可信、松弛",
    "energy": "MEDIUM",
    "salesPressure": "LOW",
    "forbiddenStyles": [
      "NEWS_ANCHOR",
      "CORPORATE_NARRATION",
      "LIVE_SELLING_SHOUT",
      "SCRIPT_READING"
    ]
  },
  "performanceArc": [
    {
      "unitIds": ["U001", "U002"],
      "intent": "直接反问和判断",
      "energy": "MEDIUM_HIGH",
      "note": "抓人但不喊"
    }
  ],
  "performanceBeats": [
    {
      "beatId": "B001",
      "unitIds": ["U001", "U002"],
      "intent": "反问 + 判断",
      "localPerformanceDelta": "直接但不喊",
      "emphasis": ["根本不是方法"],
      "rhythmHint": "自然短停"
    }
  ],
  "generationWindows": [
    {
      "windowId": "GW001",
      "beatIds": ["B001"],
      "unitIds": ["U001", "U002"],
      "instruction": "自然直接地反问，有判断感，但不喊、不播音。",
      "rhythmPlan": [],
      "transitionPauseMsAfter": 180,
      "seedPolicy": "KEEP_IF_GOOD"
    }
  ],
  "rehearsal": {
    "unitIds": ["U001", "U002"],
    "reason": "容易暴露广告腔"
  },
  "pronunciation": [],
  "qcFocus": ["开头不喊", "整篇像同一次录制"],
  "missingInputs": []
}
```

recommendedMode 只能：

```text
CONTINUOUS
DIRECTED_WINDOWS
CONTINUOUS_WITH_LOCAL_REPAIR
```

# 6. Execution Plan 示例

```json
{
  "schema": "CHATGPT_EXECUTION_PLAN_V1",
  "protocolVersion": "1.2",
  "capabilitiesVersion": 1,
  "planId": "repair-case1-r2",
  "taskId": "RS-001",
  "taskRevision": 4,
  "exportId": "EXP-004",
  "contextHash": "def456",
  "action": "REGENERATE_REPAIR_WINDOW",
  "targets": {
    "windowIds": ["GW002"],
    "unitIds": ["U006", "U007"]
  },
  "changes": [
    {
      "scope": "WINDOW",
      "targetId": "GW002",
      "field": "instruction",
      "value": "像本人自然解释，可信但不正式，不播音、不喊卖。"
    }
  ],
  "keepUnchanged": ["originalText", "voiceId", "seed", "pitch", "volume"],
  "repair": {
    "mode": "SINGLE_WINDOW",
    "windowIds": ["GW002"],
    "unitIds": ["U006", "U007"]
  },
  "regenerate": true,
  "reconcat": true,
  "validationFocus": ["消除宣传片感", "前后连接自然"],
  "missingInputs": []
}
```

# 7. action 白名单

```text
UPDATE_ONLY
REGENERATE_WINDOW
REGENERATE_REPAIR_WINDOW
JOINT_REPAIR
RECONCAT_ONLY
NO_CHANGE
```

# 8. repair.mode

```text
SINGLE_WINDOW
MULTI_WINDOW
BOUNDARY_JOINT
FULL_CONTINUOUS
NONE
```

# 9. 可修改字段

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

Runtime Schema 必须校验 field 对应 value 的真实类型/范围。

# 10. 永久禁止

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

# 11. Instruction 强制规则

任何 `instruction` 必须同时：

```text
hanCount <= 40
weightedCount <= 100
```

计数：

- Han 字符 = 2 weighted；
- 其他 Unicode code point = 1 weighted；
- Han 字符同时计入 `hanCount`。

ChatGPT 不需要返回计数值。

**软件必须自己计算，ChatGPT 自报计数无效。**

如果超限：

- 不执行；
- 不截断；
- 不静默精简；
- 返回“Instruction 超限”，让用户使用软件的“复制精简请求”。

# 12. 缺信息

不得猜。

使用：

```text
action = NO_CHANGE
```

并填：

```json
"missingInputs": ["缺少……"]
```

# 13. 解析

- 0 个合法协议 JSON：拒绝；
- 1 个：继续；
- >1 个：拒绝；
- 不智能修复语义错误 JSON；
- `additionalProperties = false` 或等效严格模式。

# 14. 防旧方案/重复执行

校验：

- taskId
- taskRevision
- exportId
- contextHash
- planId
- planHash

不一致/已执行：拒绝。

# 15. 执行前

必须 Diff Preview。

必须用户确认。

# 16. 给 ChatGPT 的锁定句

```text
你可以先正常解释判断。

但回复最后必须输出且只输出一个符合当前任务指定 Schema 的 JSON 代码块。

不得省略必填字段，不得创造未知字段，不得猜缺失 ID，不得修改锁定字段。

所有 instruction 必须同时满足：
- 汉字最多40个
- API加权字符最多100
汉字按2计，其余字符按1计。

不要自行报告计数值；软件会重新计算。

信息不足时返回 NO_CHANGE，并用 missingInputs 说明缺什么。

软件只执行 JSON，不执行你的自然语言解释。
```

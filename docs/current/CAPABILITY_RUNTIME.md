# Token Saver Runtime

默认 responseMode=compact；normal 返回详细结果但不回传默认日志；debug 显式返回完整脱敏结果。结果文件位于数据根 config/capability-results/<executionId>.json，compact 返回 resultPath/logPath、taskId/jobId、状态、摘要、输出路径。媒体 Base64 不回传。输入不压缩。

CLI：chigetang.cmd capability execute request.json。以下为请求示例：

```json
{"capability":"capability.search","params":{"query":"tasks","limit":5}}
```

```json
{"capability":"capability.describe","params":{"id":"tasks.create"}}
```

```json
{"capability":"jobs.submit","params":{"requestId":"unique-local-001","request":{"capability":"text.process","params":{"text":"原始完整文本","operation":"trim"}}}}
```

```json
{"capability":"jobs.wait","params":{"jobId":"返回的jobId","timeout":30000}}
```

jobs.wait 的 timeout 单位毫秒，0–240000；超时只返回当前状态，不取消、不重发。等待的是 capability/job 完成；视频生成提交后仍需 tasks.get/refreshStatus 跟踪 Provider 生命周期。唯一 requestId 保证重复相同请求复用原job；不同请求禁止复用。

MCP tools/list 只暴露 capability_search、capability_describe、jobs_submit、jobs_status、jobs_wait。通过 jobs.submit 的 request 指定目标能力。需要详细结果时显式 responseMode=debug；需要结果日志时 logs.read(executionId,lines=50)，最多200行；通过发现或 jobs.submit 调用。capability list 是人工显式全量诊断入口，不是模型默认发现方式。

confirm:true 不代表人类已经批准费用。真实付费前必须报告具体计划并等待明确授权。

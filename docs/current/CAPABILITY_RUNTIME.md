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

## v1.4.2 P1 一次性真实验收

正式生产模式与原隔离模式保持原策略。仅 `--agent-headless --agent-control-paid-acceptance` 可启用真实验收，仍通过已有隔离根验证，必须是独立OS临时目录、具备验收夹具及一次性授权清单。清单不含API Key；加密凭据只保存在隔离数据库与Chromium凭据目录。
授权启动时消费，重启不可复用；有效期最多1小时。限定A/B/C/D验收任务名、单个3秒以内参考视频、wan3.0-video、2秒480P9:16、audio/prompt_extend/watermark=false、seed=123、固定Prompt。单并发、maxRetries=0，最多4个提交；尝试标记先于网络写入，失败也不释放名额。其他付费POST拒绝。正式生产队列不会恢复，生产数据根不用于本次验收。
费用按原价每条1.50元预留，总预算6.00元；账单需要独立核对，不能将本地估算冒充实际扣款。

## 验收入口封存状态

【v1.4.2 后台视频生产能力：ACCEPTED，按4/4验收完成】

用户于2026-10-02决定结束本轮验收：三项真实WAN验收PASS；一键生成状态为ACCEPTED / WAIVED，用户接受现有控制链验证并免除再次真实付费验收。不得再为这四项产生验收费用，不再修改底层Capability控制架构；当前控制平台作为正式可用基础设施，版本保持v1.4.x，禁止进入v1.5.0。一次性入口仅保留历史技术与审计说明；禁止重新创建授权清单或执行四项验收。详见[项目状态](PROJECT_STATUS.md)。

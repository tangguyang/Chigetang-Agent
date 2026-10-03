# 项目状态

当前功能版本 v1.5.0，稳定历史发布基线 v1.4.5。正式路径沿用 [正式环境](ENVIRONMENT_V145.md)。Qwen、V2 与 CosyVoice 数据结构保留；统一生成任务只建立读穿索引和用户元数据。

【v1.4.2 后台视频生产能力：ACCEPTED，按4/4验收完成】

用户于2026-10-02决定结束本轮验收：三项真实WAN验收PASS；一键生成状态为ACCEPTED / WAIVED，用户接受现有控制链验证并免除再次真实付费验收。不得再为这四项产生验收费用，不再修改底层Capability控制架构；此处是历史 v1.4.2 付费验收结论；不自动授权后续付费。用户现已单独授权 v1.5.0 产品开发。

|能力|最终项目状态|真实执行事实|
|---|---|---|
|参考生视频 / 视频生成|PASS|真实WAN生成、Completed、下载及ffprobe通过|
|一键生成|ACCEPTED / WAIVED|测试包素材引用校验拒绝，未付费提交；用户豁免|
|一键复刻|PASS|真实WAN生成、Completed、下载及ffprobe通过|
|独立任务复制|PASS|真实WAN生成、Completed、下载及ffprobe通过|

真实生成调用仍为3次，付费重试0；原价用量计算4.50元，实际扣款未查询，不以项目验收口径改写账单或任务证据。

[最终验收报告](../acceptance/v142-real-production-report.md) · [真实执行证据](../acceptance/v142-real-production-results.json)

## v1.5.0 产品化
当前功能版本为 v1.5.0；v1.4.5 为稳定历史基线，环境路径不变。新工作流与索引边界见 [生产工作流](PRODUCTION_WORKFLOW_V150.md)。本轮不重做迁移，不增加Provider或重写Task/Asset数据库；ProductionService使用原记录及已有KV元数据，CopyWorkflowService只做现有执行链的准备与批次编排。收费历史证据和豁免边界保持原结论。


## v1.5.0 本轮产品验收（2026-10-04）

离线回归220/220、原有UI71/71、媒体工作台12/12、Qwen专项3/3、固定运行时3/3及新生产工作流交互检查通过。真实SenseVoice本地转写及PDF导出通过；源码与绿色包的正式Agent Control/MCP控制链均通过，167项能力、5个MCP入口，无收费POST。原生GUI核对双来源记录、外显备注、独立收藏筛选和复制批次人工入口；Qwen明确失败状态经过正式控制链创建并验证重启持久性，SubmissionUnknown保留结果待核对，禁止自动重提。

v1.4.2真实WAN和一键生成豁免结论不变；本轮fake Provider完整生产链不冒充新增真实付费视频或人工音色听感验收。user-assets初始化为空，测试alias只在隔离目录。最终发布身份与完整24项验收以本机《吃个糖Agent_v1.5.0_开发完成与验收报告.md》和正式runtime.status为准。

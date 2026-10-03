# 当前交接入口 / v1.5.0

源码权威基线为 GitHub dev。Windows x64 运行时准备与包验证见[可复现发布](docs/current/REPRODUCIBLE_RELEASE.md)；当前功能版本1.5.0，正式路径与迁移说明见 docs/current/ENVIRONMENT_V145.md。环境统一不改变已验收视频业务逻辑。

【v1.4.2 后台视频生产能力：ACCEPTED，按4/4验收完成】

用户于2026-10-02决定结束本轮验收：三项真实WAN验收PASS；一键生成状态为ACCEPTED / WAIVED，用户接受现有控制链验证并免除再次真实付费验收。不得再为这四项产生验收费用，不再修改底层Capability控制架构；当前控制平台作为正式可用基础设施，该历史验收不自动授权后续付费；用户现已单独授权 v1.5.0 产品开发。

一键生成未真实付费提交：上轮验收包缺少素材引用，导入校验拒绝。用户豁免后项目按4/4完成，禁止将该项改写为真实WAN成功。原始失败与三项成功任务、文件、用量证据保留。一次性付费授权已消费，不能复用。

权威入口：[AGENTS.md](AGENTS.md) · [项目状态](docs/current/PROJECT_STATUS.md) · [最终验收报告](docs/acceptance/v142-real-production-report.md) · [当前架构](docs/current/CURRENT_ARCHITECTURE.md)。docs/archive为历史资料；不按旧费用确认或待执行列表重复验收。

本轮 v1.5.0 开发边界与接口见 docs/current/PRODUCTION_WORKFLOW_V150.md。正式路径沿用 v1.4.5，不重复数据库迁移或旧环境清理。生成任务读取原业务记录，原 Qwen / RealSpeech V2 / CosyVoice / Replica 存储保持；任务备注收藏用已有 KV。生产核心 manifest 未经明确指定保持为空。


## v1.5.0 本轮产品验收（2026-10-04）

离线回归220/220、原有UI71/71、媒体工作台12/12、Qwen专项3/3、固定运行时3/3及新生产工作流交互检查通过。真实SenseVoice本地转写及PDF导出通过；源码与绿色包的正式Agent Control/MCP控制链均通过，167项能力、5个MCP入口，无收费POST。原生GUI核对双来源记录、外显备注、独立收藏筛选和复制批次人工入口；Qwen明确失败状态经过正式控制链创建并验证重启持久性，SubmissionUnknown保留结果待核对，禁止自动重提。

v1.4.2真实WAN和一键生成豁免结论不变；本轮fake Provider完整生产链不冒充新增真实付费视频或人工音色听感验收。user-assets初始化为空，测试alias只在隔离目录。最终发布身份与完整24项验收以本机《吃个糖Agent_v1.5.0_开发完成与验收报告.md》和正式runtime.status为准。

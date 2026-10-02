# v1.4.2 最终真实生产验收 / P1

【v1.4.2 后台视频生产能力：ACCEPTED，按4/4验收完成】

用户于2026-10-02决定结束本轮验收：三项真实WAN验收PASS；一键生成状态为ACCEPTED / WAIVED，用户接受现有控制链验证并免除再次真实付费验收。不得再为这四项产生验收费用，不再修改底层Capability控制架构；当前控制平台作为正式可用基础设施，版本保持v1.4.x，禁止进入v1.5.0。

项目验收4/4完成不等于四项都执行了真实WAN任务。保留三项成功与一项未提交的技术证据，未新增生产功能，版本仍为1.4.2。

|链路|结果|WAN taskId|MP4字节数|秒|
|---|---|---|---:|---:|
|参考生视频|PASS|97625e11-1c91-4ebd-8198-ca92cb60deae|914948|2|
|一键生成|ACCEPTED / WAIVED（用户豁免）|未提交|—|—|
|一键复刻|PASS|5e97901e-7e1a-49cb-91cc-87dd69a183e7|909068|2|
|独立任务复制|PASS|a58f3db7-d864-4ef6-8ec5-44e0160ac0a0|911493|2|

真实生成提交3次，全部HTTP200且attempt=0；自动付费重试0。每项Provider返回输入视频3秒、输出2秒、480P、30fps，三项按官方原价计算4.50元，若7折适用3.15元。当前API Key集成不支持实际账单/余额查询，实际扣款未知，不能将用量估算称为实际账单。无第四次请求，无余额/优惠抵扣假设。

参数：wan3.0-video，cn-beijing，3秒参考视频，输出2秒，480P，9:16，audio=false，prompt_extend=false，watermark=false，seed=123，固定Prompt“保持参考素材中的主体与动作。”。Provider价格：https://help.aliyun.com/zh/model-studio/model-pricing 。

A：tasks.create → EngineTaskService / SafeWanAdapter → WanAdapter → WAN；C：replica.import/update/preflight/confirm/submit → TaskService → SafeWanAdapter → WAN；D：tasks.clone(independent=true) → draft.save / estimate → tasks.create → Existing Service → WAN。全部经CLI / Agent Control named-pipe / Capability Registry；真实状态经历Processing、Completed，自动下载，ffprobe H.264可读，实际2.000秒。D新task/group/draft与A独立。

B失败原因：本次准备的任务包声明了motion参考视频，但固定Prompt无@motion引用，packages.import被正确拒绝。该失败属于验收包准备错误；不是WAN或下载故障。没有调用packages.submit，没有真实taskId，没有费用；未擅自改Prompt或放宽任务包校验。用户已主动接受现有控制链验证结果，并免除后续真实付费验收；该链路项目状态为ACCEPTED / WAIVED，技术事实仍为任务包导入拒绝、未进入付费提交。验收已结束，不再申请授权或重新提交。

原始下载位于专用OS临时根，稳定交付备份在acceptance/v1.4.2-video-2026-10-02/paid-api-acceptance/outputs/A-wan3.0-2s.mp4、C-wan3.0-2s.mp4、D-wan3.0-2s.mp4。备份与下载文件SHA256一致，ffprobe重新校验通过。完整本地任务ID、云端ID、状态时间线、用量、hash与路径见v142-real-production-results.json。原始材料不加入Git，无API Key明文。

## P1 修复与保护

阻塞原因：旧包只允许固定生产根，隔离验收完全断网；生产历史队列为暂停，不能为测试恢复。最小修复只增加headless且一次性的真实验收入口，复用原OS临时根验证。正常生产与原隔离模式不变；生产库不作为执行根，不恢复历史队列。
授权文件不含Key，启动即消费，重启失效；有效期最多1小时。A/B/C/D任务白名单，严格模型/参数/单参考素材，单并发、maxRetries=0，每项尝试写盘后才联网，最多4次、原价上限6元，失败不释放名额；其他付费POST拒绝。加密账户从一致性只读快照复制，仅为隔离验收使用，生产账户未修改。

修复前非付费回归209/209+2项闸门测试、离线绿色程序/CLI/MCP通过；最终归并211/211，71项DOM与专项UI、build/typecheck、静态PE/版本/hash与离线控制验证通过。真实验收完成后，实际重启同一授权的程序退出码1、授权拒绝、网络日志字节不变，证明没有重新请求。见v142-paid-restart-safety.json。
全程无OCR、屏幕识别、鼠标、键盘、GUI操作；headless开始与结束windowCount=0，通知禁用，未创建业务窗口。本次未执行视觉或人工焦点观察，后台机制与自动化证据通过。

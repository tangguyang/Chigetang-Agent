# v1.4.2 当前架构

Agent → CLI/MCP → Windows named pipe Agent Control → Capability Registry → GUI 共用 dispatcher → Existing Services → Provider / SQLite / 本地媒体工具。

主进程负责唯一数据库 writer、费用/参数校验、任务调度、日志和输出下载。MCP 仅公开五个发现/调度入口；完整能力通过 search / describe 按需读取。执行结果在 IPC 出口按 responseMode 格式化，内部工作流引用、jobs 结果和所有生成输入仍完整。

关键代码：src/main/index.ts（共用 dispatcher）、capabilities/registry.ts（校验及队列）、runtime.ts（发现与结果控制）、jobs.ts（持久化异步执行和等待）、realSpeech/v2/controlPipe.ts（主进程通信）。任务中断保持 unknown，不自动重发付费请求。

资产：libraryView.ts 统一任务结果与本地媒体；来源通过现有任务关联非破坏性归类。显式隐藏记录存放 settings.library-hidden；历史 assets.libraryDeletedAt 兼容并可恢复。文件失效状态与隐藏分开。ThumbnailQueue 使用本地 FFmpeg 生成缓存，不新增 Provider 逻辑。音频卡直接播放且新播放暂停其他音频。

真人口播 Page 的新 Plan 输入每次挂载为空；保存后清空输入/preview/attestation，仅清理编辑状态，不删除历史、音频或计划。

运行手册镜像仍在 resources/real-speech-v2、resources/docs。历史源码设计在 docs/archive。付费端到端四项保持 PARTIAL PASS，见 docs/acceptance/v1.4.2-acceptance-report.md。

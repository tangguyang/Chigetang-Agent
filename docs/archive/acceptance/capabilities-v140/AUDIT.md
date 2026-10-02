# v1.4.0 源码审计与架构取舍

基线：GitHub origin/dev，3774703。实际产品版本1.3.0，规格文档声称1.3.3与仓库不符。目标版本1.4.0采用用户给定目标，产品版本统一更新。文档将架构升级描述为major但目标是minor，这是术语差异，不另改目标版本。

原桌面主进程以Application组合assets、tasks、audio、drafts、billing、folders、prompts、credentials。转写、工具、任务包、复刻、真人口播新旧版本各有独立Service。1.3.0已有SpeechAgentControl、Windows Named Pipe控制桥、单写入租约和脱敏CLI，范围主要是真人口播V2。

本次将现有IPC业务switch提取为共享invokeOperation和invokeSpeech，GUI做发送者验证后调用，后台通过注册表校验后调用。Service业务不复制。路径选择/确认/打开输出等UI副作用在后台路径被明确参数替代或跳过。headless模式不创建BrowserWindow、Tray或Notification。

注册表、Schema、校验器和执行器在src/main/capabilities。异步任务台账复用同一执行队列，启动恢复仅标未知，不重发云端任务。工作流只负责引用替换、执行顺序和错误传播，不分析导演内容或重新编译TTS参数。

新增媒体方法在LocalTools，裁切/拼接/音频转换复用已有transcode Service；抽帧和视频格式转换使用白名单FFmpeg参数。新输出放独立目录，文件/图片/SRT导出使用独占创建，不覆盖原始文件。

普通云端ChatGPT连接是另一项部署工作，本地stdio MCP已交付但未对外暴露。后台功能覆盖范围及保留人工操作详见README，当前不是无条件的“全部功能验收”。

交付遵循此前确认的GitHub dev源码基线和仅Windows x64绿色运行包，不制作规格列出的源码ZIP，不包含用户数据库、账户和密钥。

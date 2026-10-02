# 吃个糖 Agent 当前开发入口

当前正式版本：v1.4.2。长期源码基线为 GitHub tangguyang/Chigetang-Agent 的 dev。禁止未经用户批准进入 v1.5.0。

先读 [当前架构](docs/current/CURRENT_ARCHITECTURE.md)、[运行控制](docs/current/CAPABILITY_RUNTIME.md)、[开发命令](docs/current/DEVELOPMENT.md)。docs/archive 仅为历史证据，不能据其版本号或旧方案修改当前实现。

GUI / CLI / MCP → Agent Control → Capability Registry → 同一 Existing Service → Provider。保持 SINGLE WRITER，不直接打开生产库做控制，不用 OCR、鼠标键盘模拟或焦点切换实现后台业务。

Token Saver 只压缩控制结果；原始 Prompt、Plan、Window、素材、WAN/CosyVoice 参数完整传给 Service，不摘要、不截断。付费/破坏性 capability 的 confirm:true 是技术闸门，不能替代人类付费授权。本轮真实 WAN/CosyVoice 调用均暂停，任何真实付费请求必须先报告次数、模型、费用并获得明确批准。离线测试使用隔离 AIVIDEO_TEST_ROOT 与 fake provider。

生产数据根目录 D:\吃个糖Agent数据库-v1.3.0 全部受保护。禁止删除数据库、Key、Chromium凭据配置、用户素材、历史任务、生成结果。工程清理先盘点并输出明确目标清单；仅清理可重建内容。禁止 git clean -fdx、reset --hard、force push、history rewrite。历史文档用 git mv 归档。无法确认的目录保留。

开发流程：连续本地开发 → npm ci / typecheck / 全部测试 → build → 最终 Windows x64 绿色包隔离验证 → 统一一次 commit + push 到 dev。不生成安装程序，不交付源码 ZIP，不依赖反复等待 CI。

普通技术选择自主处理；只有数据损坏风险、不可逆迁移、真实付费、实质目标冲突才暂停。默认中文沟通，称呼用户老唐。

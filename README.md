# 吃个糖 Agent v1.5.0

以一键复刻、一键复制、视频生成为核心的本地短视频生产系统；Codex / AI Agent 主驾驶，GUI 可人工接管。GUI、CLI、MCP 共用主进程和业务 Service，Agent 可无窗口调用能力、工作流和本地长任务。

本机唯一正式软件为 D:\吃个糖Agent\吃个糖Agent.exe，唯一生产数据根为 D:\吃个糖Agent软件数据库；后台启动使用 agent-start.cmd，退出使用 agent-stop.cmd。数据库单写保护始终启用。付费提交须先获得明确授权。

开发入口：[AGENTS.md](AGENTS.md) · [当前架构](docs/current/CURRENT_ARCHITECTURE.md) · [Capability Runtime](docs/current/CAPABILITY_RUNTIME.md) · [开发与验收](docs/current/DEVELOPMENT.md) · [版本记录](CHANGELOG.md)。历史资料位于 docs/archive，仅作为证据。

Windows x64 重建：`git clone --branch dev https://github.com/tangguyang/Chigetang-Agent.git` → `npm ci` → `npm run prepare:runtime` → `npm run verify` → `npm run pack:win` → `npm run verify:package`。固定运行时、环境要求与验证边界见[可复现发布](docs/current/REPRODUCIBLE_RELEASE.md)。

【v1.4.2 后台视频生产能力：ACCEPTED，按4/4验收完成】

三项真实WAN PASS，一键生成ACCEPTED / WAIVED（用户豁免，未真实付费提交）。本轮验收已结束，禁止再次收费验收。当前平台视为正式可用基础设施。详见[项目状态](docs/current/PROJECT_STATUS.md)与[交接入口](HANDOFF.md)。

[正式环境与迁移说明](docs/current/ENVIRONMENT_V145.md)。GUI 设置页和 `runtime.status` 可核对完整构建身份。dev 为开发分支；本轮发布后 main 与 v1.5.0 tag 同步，v1.4.5 tag 保留稳定历史基线。

[生产工作流与 Codex 接口](docs/current/PRODUCTION_WORKFLOW_V150.md)：统一生成任务、任务备注/收藏、上传素材、显式核心 alias 和复制批次。v1.4.5 tag 保持稳定历史基线；本轮正式稳定发布为 v1.5.0。

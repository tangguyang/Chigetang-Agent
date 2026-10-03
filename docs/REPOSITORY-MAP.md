# 仓库地图

默认阅读：AGENTS.md → README.md → HANDOFF.md → 任务相关源码与测试。
普通任务不扫描全部历史 docs。

| 目录 | 职责与边界 |
|---|---|
| src/main | Electron 主进程、业务 Service、数据库与迁移、API 账户、WAN/Qwen/CosyVoice、任务恢复、Agent Control |
| src/renderer | React 页面、交互组件、状态与工具界面 |
| src/shared | 共享类型、模型目录、任务包协议、校验和兼容逻辑 |
| src/features/realSpeech | 真人口播界面、协议领域逻辑 |
| src/cli | CLI/MCP 入口与控制请求 |
| tests | 核心/历史兼容回归与 fixtures；媒体和 ZIP 是测试输入 |
| scripts | 开发、构建、测试与打包；旧工具用途见脚本索引 |
| resources | 受保护的运行/打包资源、品牌图标、协议镜像、工作流、sherpa-onnx 说明 |
| examples | 任务包示例，保留协议参考 |
| licenses | 第三方许可，打包保留 |
| docs | current 为当前架构与状态；acceptance 为验收证据；migrations/schema 为数据库资料；archive 为历史参考 |

## 当前文档入口
1. [项目说明](../README.md)
2. [交接与验收边界](../HANDOFF.md)
3. [当前架构](current/CURRENT_ARCHITECTURE.md)
4. [运行控制与 CLI/MCP](current/CAPABILITY_RUNTIME.md)
5. [开发与测试命令](current/DEVELOPMENT.md) · [可复现发布](current/REPRODUCIBLE_RELEASE.md)
6. [项目状态](current/PROJECT_STATUS.md)
7. [脚本索引](current/SCRIPT_INDEX.md)
8. [数据库](DATABASE.md)
9. [真人口播 Runtime 字段](真人口播_Runtime字段说明.md)
10. [最终生产验收报告](acceptance/v142-real-production-report.md)

## 文件保护
package-win.mjs 转交 package-agent-control-ipc.mjs，后者复制整个 resources、docs、licenses。
docs 与 resources 中的协议镜像由 check-real-speech-docs.ts 校验一致性，不能当重复文件删除。
历史迁移、旧测试、验收记录即使版本旧也保留；用户数据和凭证不进入 Git。
README-USER.md、DELIVERY.md 的现有历史版本位于 archive/readmes，不代表当前交付说明。

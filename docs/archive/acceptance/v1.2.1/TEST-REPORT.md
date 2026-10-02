# 吃个糖 Agent v1.2.1 Professional｜自动化测试报告

日期：2026-09-22

## 已执行

| 层级 | 命令/对象 | 结果 |
|---|---|---|
| 依赖 | `npm ci --ignore-scripts` | 通过 |
| 类型 | `npm run typecheck` | 通过 |
| 核心与回归 | `npm test` | 94/94 通过 |
| UI 单元 | `npm run test:ui` | 59/59 通过 |
| 媒体 bundle | `npm run test:bundle` | 真实 MP4 解析通过 |
| 生产构建 | `npm run build` | 通过 |
| 成功模板 | 用户提供的单/多任务 ZIP | CRC、SHA-256、路径、绑定、整数时长通过 |

## v1.2.1 专项用例

- 一次返回多个字段、素材、bindings、Prompt 和时长问题。
- 未提交导入草稿可安全清空，未引用记录与解压目录同步清理。
- 已提交包再导入时产生新 `task_id`，但不自动排队或扣费。
- 提交中/状态未知会话仍禁止自动重发。
- 三份冻结指令与单/多任务模板已纳入应用资源。

## 未执行

- Windows 10/11 真机手工点击、托盘、DPAPI、桌面快捷方式验收。
- 真实 API Key 下的 Wan 3.0 付费生成。
- 安装包签名；本版交付为 Windows x64 解压运行包。

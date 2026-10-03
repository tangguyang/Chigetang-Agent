# 吃个糖Agent：开发入口

## 项目是什么
Electron + React + TypeScript 的本地 AI 视频/音频生产工具，当前版本 v1.4.2。
长期源码基线为 GitHub dev；未经授权不进入 v1.5.0。
默认中文沟通，称呼用户老唐。

## 默认阅读顺序
AGENTS.md → README.md → HANDOFF.md → 当前任务相关源码 → 当前任务相关测试。
目录与文档入口见 [仓库地图](docs/REPOSITORY-MAP.md)。
普通任务禁止先扫描全部历史 docs；仅按当前任务按需读取相关文档。
docs/archive 是历史参考与证据，不能作为当前实现或重复验收的依据。

## 主要目录
- src/main：Electron 主进程、业务服务、数据库、Provider、Agent Control。
- src/renderer：React 页面、组件与前端状态。
- src/shared：共享类型、参数校验与任务协议。
- tests：离线回归测试及受保护的 fixtures。
- scripts：开发、构建、测试与打包工具。
- resources：运行资源、品牌、协议、工作流与本地模型说明。
- docs：当前文档、迁移资料、历史证据。

## 数据原则
源码与用户数据分离；API 凭证、用户数据库、素材、生成文件不得进入 Git。
生产数据根目录 D:\吃个糖Agent数据库-v1.3.0 受保护，不删除或修改其中资料。
测试使用隔离 AIVIDEO_TEST_ROOT 与 fake provider；测试 fixtures 不因忽略规则而删除。
本地私人未跟踪目录不擅自读取、移动、修改、删除或提交。

## 开发原则
本地优先，连续完成开发后统一测试、构建，再按任务授权统一提交。
禁止小改一次 commit 一次；Codex 负责准确执行，不自行扩大任务。
保持 GUI / CLI / MCP → Agent Control → Capability Registry → Existing Service → Provider。
保持 SINGLE WRITER，不绕开控制链直接操作生产库。
原始 Prompt、Plan、Window、素材与模型参数完整传给 Service，不摘要或截断。
清理先核实用途和引用；无法确认的文件保留，历史资料优先 git mv 归档。
禁止 git clean -fdx、reset --hard、force push、历史重写。
打包、push、合并及真实付费按当前任务授权；不自动制作源码 ZIP。
发布重建先读 docs/current/REPRODUCIBLE_RELEASE.md；运行时仅用固定来源及 SHA256，不提交二进制。

## 高风险区域
API 凭证、数据库迁移、付费 API、音色、任务恢复、文件删除。
confirm:true 是技术闸门，不能替代人类付费授权。
v1.4.2 视频验收已结束：三项真实 WAN PASS，一键生成 ACCEPTED / WAIVED。
一键生成未真实付费提交，不得改写为真实 WAN PASS；禁止再次收费验收这四项。
权威结论见 HANDOFF.md、docs/current/PROJECT_STATUS.md 与最终验收报告。

## 当前音频路线
Qwen-Audio 为当前主要优化路线，保护 rate、pitch、volume、seed 四参数能力。
CosyVoice 保留；Seed-VC 路线已废弃，历史资料仅供参考。
真人口播生成、解码、GUI 播放、人工听感分别验收，不能相互替代。

# v1.4.5 正式环境

唯一源码：`D:\Codex\吃个糖Agent项目`。dev 用于开发；main 与 v1.4.5 tag 表示本轮验收后的稳定提交。

唯一日常软件：`D:\吃个糖Agent\吃个糖Agent.exe`。桌面入口与 Agent 启动脚本均来自此目录。GUI 已启动时 CLI/MCP 连接其 Agent Control，不另开业务数据库。后台模式转 GUI 时先空闲停止后台，再启动同一 EXE。

唯一生产数据根：`D:\吃个糖Agent软件数据库`。旧 `数据库`、`数据库-v1.3.0` 路径仅作为离线迁移来源，禁止继续作为生产宿主。外部用户素材继续留在原盘。

GUI 设置页与 `runtime.status` 读取同一 `resources/app/dist/build-identity.json`。最终包应报告 version=1.4.5、同一 Build ID、实际 EXE 路径和正式 Data Root。源树哈希与 dirty 状态说明包是否由已提交源码构建。

迁移工具 `scripts/migrate-production-v145.py` 仅在停写、完整备份核验后运行。备份清单位于本地 `tmp/v145-unification/backup-result.json`，对账计划与结果不提交 Git。它从已验证备份重建主数据库及口播数据库，比较主键、修订时间、SHA256；未知冲突拒绝建立目标。凭据只转移已有密文，不读取或输出明文。

本机原始数据根与日期备份受保护。恢复应停写后先保留当前正式数据，再从整套备份恢复至独立恢复目录进行核验；不能把两库文件随意覆盖到运行中的软件。SenseVoice 模型与 tokens 从旧根补入正式根；本地转写验收不调用收费 API。

仓库目录分类：src 为源码；docs/current 与根入口为当前文档；docs/archive 为历史参考；tests 为离线回归及受保护 fixtures；acceptance 为本地证据；dist、release、cache、tmp 为构建/测试产物，忽略不意味着可删。私人未跟踪目录、用户素材、数据库、凭据、模型与正式输出均不提交 Git。

v1.4.2 视频验收结论继续有效：三项真实 WAN PASS，一键生成 ACCEPTED / WAIVED，未真实付费提交。本轮不重复付费生成、不重写 Task 架构；Qwen 四参数、CosyVoice、RealSpeech 与 V2 原体系保持。

## 本机迁移验收边界

2026-10-03 本机迁移已对账：主库 33 个历史任务、143 个资产、8 个音色；RealSpeech 原始表 4 个任务，V2 40 个任务/41 个修订/51 个 job。原任务的删除标记、资产隐藏/失效状态均保留。33 个任务原已软删除，默认 tasks.list 为 0 不能解释为迁移丢失。

备份须同时保留 SQLite、WAL、SHM；逻辑对账必须读取已提交 WAL。旧主库 WAL 仅含同内容草稿的更新时间差异，当前正式草稿已有更晚保存时间，未丢失内容。SenseVoice 本地转写、非付费任务包导入/预检、音频转换、GUI 历史视频预览/文件夹打开与 Qwen 音频播放已验证。

旧库中原已失效的 20 个素材路径仍保留失效状态；一个 Qwen 历史音色状态原为 unknown，迁移不会伪造 ready。未重复提交云端收费生成，也不把 GUI 播放验证当作人工听感验收。

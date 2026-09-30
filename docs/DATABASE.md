# 数据库与升级

当前 schema 版本为 4；新增 voices（持久化音色）、asset_folders（逻辑层级），任务 JSON 增加 type 和 outputs。升级自动备份、统一事务迁移、完整性检查，失败停止。可读新增 SQL：`docs/migrations/004-v105.sql`。

实际迁移源：`src/main/database/schema.ts`。可阅读 SQL 副本：`docs/schema.sql` 与 `docs/migrations/001-initial.sql`。

|表|内容|
|---|---|
|providers / models|注册配置、能力、默认参数、价格|
|credentials|非敏感账户元数据 + 独立加密 BLOB|
|projects|项目与默认输出目录|
|assets / asset_tags / project_assets|资产、标签、多项目关系扩展表|
|prompts / prompt_versions|当前模板与只追加内容版本|
|tasks / task_versions|任务组、版本、父关系、当前状态|
|task_snapshots|不可变输入 JSON，更新触发器保护|
|task_assets|任务引用的 Asset ID、角色和顺序|
|task_results / downloads|云端原始返回与本地下载状态|
|usage_records / price_snapshots|任务成本与创建时价格|
|settings|偏好、草稿、幂等请求、目录迁移来源|
|logs_metadata|日志索引扩展预留|

常用检索字段独立建列并有索引；异构模型参数和完整历史能力写入 JSON，避免新模型参数导致全表迁移。V1 项目归属主要使用 project_id；project_assets 预留多项目关联。

新增迁移：只追加 version 5、6……，禁止修改已发布迁移。迁移在事务中执行。不得删除原始资产、不得自动重建损坏数据库。从 v1.0.4 升级前退出程序、备份旧完整目录，首次启动会复制数据到独立 UserDataRoot；后续升级只替换程序文件。具体路径和回退流程见 `../v1.0.5-Upgrade-Guide.md`。不要在 SQLite 正写入时仅复制主库文件；使用软件备份或退出后复制完整数据目录。

仅数据库备份不包含素材、视频或 Windows 系统密钥。恢复前退出程序，先保留整个旧目录，再替换 data/ai-video.sqlite 并确认 WAL 文件来自同一备份集。跨机资产应复制管理目录；引用到外部目录的素材需重新定位。

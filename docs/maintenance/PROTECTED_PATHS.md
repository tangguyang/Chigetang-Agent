# 数据保护清单
生产根目录：D:\吃个糖Agent数据库-v1.3.0（整目录禁止清理）。SQLite、config/凭据/Chromium Local State、assets、outputs、任务历史均受保护。
历史根目录：D:\吃个糖Agent数据库（保留）。
工程内 acceptance/、口播课程_导出/、一键复刻的导入任务包模板/ 含真实素材或用户文件，整体保留。
resources/、node_modules/ 为运行/开发依赖，保留；release/deliverables 保留历史交付ZIP。
只清理清单明确标记为旧构建 staging、绿色包重复解压副本的 release 子目录；删除前解析绝对路径并排除 SQLite、UserData、账户及生成输出。

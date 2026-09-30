# v1.2.1 Professional｜主要变更

- `src/shared/taskPackage.ts`：新增非抛式全量导入问题收集与统一格式化。
- `src/main/services/taskPackage.ts`：全量导入校验、已提交包自动新轮次 `task_id`、安全清空及审计保护。
- `src/main/services/stage1Template.ts`：支持专业版内置默认指令和版本元数据。
- `src/main/index.ts`：新增清空 IPC，导出三份最终指令与单/多任务模板。
- `src/renderer/pages/OneClick.tsx`：一键生成专业版 UI、清空按钮、新轮次提示和最终资料导出。
- `resources/workflow/`：用户冻结的三份指令和两个成功 ZIP 模板。
- `tests/v121.test.ts`：成功模板、全量报错、清空和新轮次专项测试。

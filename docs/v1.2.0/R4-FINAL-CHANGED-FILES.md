# R4 最终修复｜变更文件清单

## 生产代码

- `src/shared/taskPackage.ts`：无字幕/屏幕文字正向动作确定性识别。
- `src/main/services/taskPackage.ts`：隔离预检、逐会话原子发布、旧结果丢弃、确认快照安全、导入失败回滚与重启中断标记。
- `src/main/services/assets.ts`：仅对本次创建且无引用的资产记录提供精确回滚。
- `src/renderer/pages/OneClick.tsx`：当前修订号未预检时不把旧费用显示为有效费用。
- `src/renderer/pages/Generate.tsx`：严格空值类型修复。

## 测试与构建

- `tests/v120-final.test.ts`：新增 10 项字幕、竞态、提交锁、故障注入、重启恢复和文档一致性回归。
- `package.json`：将最终专项测试加入全套测试命令；版本仍为 1.2.0。
- `scripts/test-ui.tsx`：UI 当前版本断言由过期的 1.1.2 修正为 1.2.0。

## 交付文档

- `docs/v1.2.0/TEST-REPORT.md`
- `docs/v1.2.0/WINDOWS-ACCEPTANCE.md`
- `docs/v1.2.0/R4-FINAL-CHANGED-FILES.md`
- `v1.2.0-Release-Notes.md`
- `DELIVERY.md`
- `CHANGELOG.md`

三份正式复刻指令/规范内容没有发现需修改的问题，保持原文，并由自动化测试证明与 `packageGuide()` 实际导出一致。

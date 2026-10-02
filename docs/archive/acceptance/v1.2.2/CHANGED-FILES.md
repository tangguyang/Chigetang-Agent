# 吃个糖 Agent v1.2.2｜主要变更

- `src/shared/taskPackage.ts`：允许任务包 `audio` 布尔声音开关。
- `src/main/services/taskPackage.ts`：允许持久化修改 `audio`。
- `src/renderer/pages/OneClick.tsx`：默认空白、只读 Prompt、简化素材展示并恢复声音开关。
- `src/renderer/components/WorkbenchTaskSidebar.tsx`：任务列表仅保留名称、状态、提交时间。
- `resources/workflow/`：三阶段 V2.2 指令及单／多任务 V2.2 成功模板。
- `tests/v121.test.ts`：协议、映射、声音开关和新轮次回归。

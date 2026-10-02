# 吃个糖Agent v1.2.3｜转文字界面增量补丁

本补丁基于用户提供的 v1.2.3 源码，按最小改动原则完成：

- 左侧导航在“复刻音色”下新增“转文字”。
- 新增“音视频转文字”页面。
- 标题右侧依次新增：任务保存目录、AI 模型目录、模型安装说明三个图标按钮。
- 任务保存目录固定为 `D:\吃个糖Agent数据库\outputs\transcription`。
- 模型目录固定为 `D:\吃个糖Agent数据库\models\sensevoice`。
- 内置 `音视频转文字_模型安装指南.txt`，按小白可执行方式说明 SenseVoice Small INT8 的下载、解压和放置路径。
- 软件启动默认页面改为“一键生成”。
- 未修改现有生成视频、生成音频、复刻音色、任务、资产库、模型/API 和设置业务逻辑。

## 修改文件

- `src/renderer/main.tsx`
- `src/renderer/store.ts`
- `src/renderer/style.css`
- `src/main/index.ts`
- `scripts/test-ui.tsx`

## 新增文件

- `src/renderer/pages/Transcription.tsx`
- `resources/docs/音视频转文字_模型安装指南.txt`
- `docs/archive/acceptance/v1.2.3/TRANSCRIPTION-UI-PATCH.md`

## 验证边界

当前环境无法从 npm registry 完成依赖安装，因此未宣称完成完整 Electron/Windows 构建。已对本次修改的 TypeScript/TSX 做语法级转译检查，并对改动范围做逐文件比对。

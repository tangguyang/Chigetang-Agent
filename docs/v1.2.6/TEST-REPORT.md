# v1.2.6 本地任务编译验证

实际测试覆盖：真实 8 秒合成视频与配音分别按两段 3.5 秒 GEN 区间裁切，生成不同的参考视频和独立音频；标准 ZIP 由生产解析器验证，拒绝未确认方案。

- `npm test`：99/99 通过（新增本地编译定向用例）。
- `npm run test:ui`：66/66 通过，包含一键生成编译入口检查。
- `npm run typecheck`、`npm run build` 通过；`npm run test:bundle` 使用真实 MP4 验证构建后的 MediaInfo，通过。
- 基于已校验 v1.2.5 Windows x64 基础运行时嵌入 v1.2.6 构建；`node scripts/verify-package.mjs` 对 PE、EXE 版本 1.2.6、图标、FFmpeg x64、内置文件哈希和用户数据目录隔离检查通过。

边界：Linux 自动化不等于 Windows 真机操作，未调用收费 Wan API。方案 JSON 由经用户确认的核对稿转写；编译器不会推断画面语义或替用户批准计划。

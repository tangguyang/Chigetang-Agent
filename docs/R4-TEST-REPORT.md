# 吃个糖 Agent v1.2.0｜R4 候选修复与验收记录（非正式发布）

## 代码基线与改动

唯一代码基线：用户上传的 `吃个糖Agent-v1.2.0-R3-P0-CHECKPOINT.zip`；未回退 v1.1.2。本轮在原生产导入器、草稿和任务队列上 Patch，未调用外部 Wan API。

- `src/shared/taskPackageDocs.ts`：第一阶段正文按 v1.1.3 时间确认规则重新整合，含短/长两套可编辑时间表与无字幕分镜；第二阶段与 v1.2.0 协议同义；规范补全标准别名类型、真实参考文件及 source_range_ms 语义。
- `src/shared/taskPackage.ts`：无字幕子句肯定动作扩展；后期完整音频素材类型与 segment_order 类型检查。
- `src/main/services/taskPackage.ts`：提交期间禁止外部独立预检；崩溃恢复时将 submitting → blocked 立即原子持久化；同 task_id 并发重复导入门禁；只读来源区间传递到 UI。
- `src/renderer/pages/OneClick.tsx`：自定义模板真实来源版本与文件名显示；来源时间字段未提供时如实说明。
- `tests/v120-protocol.test.ts`、`tests/fixtures/v120-valid-realmedia-*`、负向夹具：真实格式合成 JPG/MP4/WAV、SHA/CRC 与多个拒绝场景，避免把历史 1.1 示例冒充 1.2.0。
- 三份 `docs/v1.2.0/*.md` 为 `packageGuide()` 实际输出，非手写不同版本。

## 实际执行与结果

- 定向测试：`node --experimental-strip-types --test tests/v120-protocol.test.ts` → 16/16 通过（含并行导入和生产 importZip 负向测试）。
- 关联回归：`node --experimental-strip-types --test tests/v120.test.ts tests/v112.test.ts tests/v120-followup.test.ts tests/v120-r3.test.ts` → 18/18 通过。
- 全量尝试：`node --experimental-strip-types --test tests/v102.test.ts tests/v104.test.ts tests/v109.test.ts tests/v110.test.ts tests/v111.test.ts tests/v112.test.ts tests/v120.test.ts tests/v120-followup.test.ts tests/v120-r3.test.ts tests/v120-protocol.test.ts` → 77 项，76 通过，1 因 `mediainfo.js` 缺失在加载阶段失败；不得算通过。
- 实测合成样例媒体：使用 ffprobe 得到两条参考 MP4 分别为 9.600 秒、WAV 为 14.000 秒；图片为 JPG。样例仅合成数据，**不是《空腹理想体重》真实业务视频**。
- `npm ci --ignore-scripts --offline` → 失败 `ENOTCACHED: zustand@5.0.3`；联网安装未能完成。当前 Node 22.16.0，项目要求 Node >=24.19.0。
- `npm run typecheck` → 失败 `TS2688: Cannot find type definition file for 'node'`，缺少锁定依赖 `@types/node`。

## 未验证、风险与放行条件

- 当前环境 Linux，未完成 Windows x64 Electron 实际构建、安装/启动、独立测试用户目录的真实非付费 UI 导入/编辑/预检、旧真实 Windows 包兼容及用户数据升级验收。不能用 TypeScript 解析、Mock 队列或 Node 生产解析器通过冒充 Windows 实测。
- 原始 v1.1.3 指令经 File Library 内容比对整理，但未取得原始文件字节，因此不声称与母稿逐字/字节一致。
- 未对真实 Wan 付费 API 生成/下载、成片字幕和口型进行测试；用户未授权真实付费调用。
- P1 资产导入部分失败后的持久化孤儿清理仍采用保守策略（保留可能已被资产库引用的解压文件），未完成各种故障注入验证。
- 必须补齐 Node >=24.19.0、完整 `npm ci`、完整 `npm test`、`npm run typecheck`、`npm run test:ui`、`npm run test:bundle`、`npm run pack:win`、Windows x64 运行与非付费真实导入，才能评估是否正式发布。

**状态：R4 候选源码检查点，不是正式稳定版；无 Windows EXE 交付。**

## 解压交付核验

完成所有源码修改后，按照 `scripts/package-source.py` 重新生成完整源码包和 `SOURCE-SHA256.json`。所有协议示例和负向夹具在 tests/fixtures，正式 1.2.0 合成单段样例在 examples。ZIP CRC、哈希清单、三份软件导出指南与 docs/v1.2.0 同字节及重解压测试结果见随交付的独立验证记录。

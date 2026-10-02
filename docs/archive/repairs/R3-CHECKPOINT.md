# 吃个糖 Agent v1.2.0｜R3-P0 开发检查点（非发布版）

基线：本次上传的 v1.2.0 Source-CANDIDATE-R2.zip，最小补丁，尚未完成 R2 最终修复需求。

本检查点真实修改：
- src/main/services/taskPackage.ts：同 session 并发提交同步独占门禁、预检前后快照复核，编辑/确认期间拦截；预检失败仍保留 ready 状态，原任务队列沿用。
- src/shared/taskPackage.ts：默认 duration 接受 -1 或整数 2–30；正式 1.2.0 标准别名 person/product、motion、voice 严格对应图、视频、音频；分子句识别明确要求额外字幕、文字和水印的正向指令。
- src/main/services/stage1Template.ts：恢复默认后 current.custom=false；来源版本和来源文件分开显示，保留之前模板和原始文档。
- tests/v120-r3.test.ts：新增冲突字幕、时长边界和 Promise 并发提交测试。

实际命令：node --experimental-strip-types --test tests/v120-r3.test.ts tests/v120.test.ts tests/v120-followup.test.ts
结果：13/13 通过（见 R3-TARGETED-TESTS.log）。

全量命令：node --experimental-strip-types --test tests/v102.test.ts tests/v104.test.ts tests/v109.test.ts tests/v110.test.ts tests/v111.test.ts tests/v112.test.ts tests/v120.test.ts tests/v120-followup.test.ts tests/v120-r3.test.ts
结果：60/61 通过；v111.test.ts 因当前环境未安装 mediainfo.js 在导入阶段失败（见 R3-ALL-TESTS.log）。

未完成：完整依赖安装、Node >=24.19.0、类型检查、Windows x64 构建/实机非付费导入、三份文档母稿合并和完整一致性、真实业务素材的 17 秒正例、其余 P1 回归。不得将本检查点宣称为 v1.2.0 正式稳定版。未经授权未调用 Wan 付费生成。

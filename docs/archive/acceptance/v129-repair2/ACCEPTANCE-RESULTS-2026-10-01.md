# P0验收执行记录（2026-10-01）

以冻结 P0-WORKFLOW-ACCEPTANCE.md 逐项执行。不得把模拟音频测试当成真实声音效果。

| 冻结项 | 执行证据 | 结果与范围 |
| --- | --- | --- |
| A dirty 保存/取消出口 | Windows/DOM界面实际编辑、非法41汉字、非法JSON、取消恢复 | 通过 |
| A disabled 原因 | ActionButton在禁用按钮内直接显示原因；流程测试检查超限和未知计费原因 | 通过；忙状态显示处理中 |
| A 保存反馈 | update显示保存成功；诊断就地显示保存/复制状态 | 通过 |
| A 失败恢复 | 单段失败释放锁；批量GW001未知后GW002继续；未知段手动确认/恢复下载 | 通过 |
| A 无循环保存依赖/无关试演门禁 | 首段直接生成；改中间段立即重生成 | 通过 |
| B路径1创建/原稿/阶段二/校验/预览/应用/P001/其他段 | test-repair2-workflow-ui.tsx，DOM与Windows Electron运行 | 通过；试听控件已呈现，音源为模拟WAV |
| B路径2 P003导演/Instruction保存/重生成/rev2/rev1/切版 | 同上；当前窗口历史倒序，旧文件保留 | 通过 |
| B路径3诊断/就地复制/局部修订/P001/P002不变/重生成 | 实际导出Diagnosis、导入CHATGPT_EXECUTION_PLAN_V1局部变更 | 通过；ChatGPT返回使用受控协议样例 |
| B路径4改一句/解析/保留/升revision/继续生成 | DOM与Windows事件、reconcile核心测试 | 通过；跨句Phrase也已覆盖 |
| B路径5选择当前版本/拼接/输出位置/剪映可用格式 | FFmpeg真实拼接、ffprobe及完整解码、48kHz PCM s16le WAV | 格式和文件入口通过；资源管理器实点/剪映实际导入未验证 |
| C Han40/41、weighted100/101、不截断 | v129与repair2核心计数和拒绝测试 | 通过 |
| C rate/pitch/volume/seed越界 | 核心fieldValue、导入与请求前校验 | 通过 |
| C不发送假字段 | 请求显式白名单；官方HTTP文档2026-10-01复核 | 通过 |
| C SSML和pronunciation | 模型支持字段与编译白名单；真实请求适配器模拟测试 | 本地链路通过；云端实际读法未验证 |
| D多次生成/唯一文件/snapshot | rev1/2/3和旧内容校验；请求UUID和hash | 通过 |
| D unknown/interrupted不自动重试 | 核心、改参数/音色/原稿保护、Windows批量失败事件 | 通过 |
| D双击一次 | 现有v129并发生成测试/Service active锁 | 通过 |
| E音频/音色复刻/转文字/视频/一键生成/一键复刻/资产/设置 | npm test完整156项，通用DOM71项，bundle MediaInfo真实MP4 | 现有自动化回归通过；未调用任何真实付费API |

## 完整命令结果

- npm ci：通过；最终使用Node24.19.0。
- npm run typecheck：通过，0错误。
- npm test：156/156，0 skip。
- npm run test:ui：71项通过。
- npm run test:repair2：53项核心/媒体测试通过，三套口播DOM runner通过。
- npm run test:repair2:windows：五条黄金路径、非法草稿取消和批量失败继续通过。
- npm run build：通过。
- npm run test:bundle：真实MP4通过。
- npm run pack:win：Windows x64目录生成且结构检查通过。
- node scripts/verify-package.mjs：PE版本、x64、打包源码哈希、FFmpeg、资源、无用户数据检查通过。

## 未完成的现场验收

真实CosyVoice3.5Plus付费声音效果、真人听感、生产主进程IPC全链路、资源管理器与剪映实际操作尚未验证。独立Windows交付包启动检查命令被自动审批策略拒绝，工具未给出细化理由；不得声称已启动验收。

依赖审计沿用原锁文件，报告5项（4 high、1 low）；升级打包器涉及major变更，本次未擅自扩大依赖升级范围。发布前根据实际暴露面另行处理。

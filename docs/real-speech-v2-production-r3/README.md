# 真人口播V2：第一批人工试听生产规则交付包 R3

已完成用户要求的生产规则吸收；本轮新增真实API请求0，不执行第二批，不commit/push，未启动下一阶段。

- [完整修改清单与关键Diff](关键Diff.md)
- [运行Capability Profile](COSYVOICE_CAPABILITY_PROFILE.v1.json)：draft.3，官方模型能力保留，产品推荐分离。
- [导演词典](docs/director.md)：36词条，A–G齐全；新增发音完成度/口语粗糙度、诊断式确定感、节奏型销售排比、稳→推→爆→松。
- [台词需求模板](docs/template.md)：三段真实锚点、意图层与执行层区分。
- [编译规范](docs/compiler.md)：Naturalness First、L0–L3、实验确认及单变量修复。
- [Plan Schema](schemas/REAL_SPEECH_EXECUTION_PLAN_V2.schema.json)、[Patch Schema](schemas/REAL_SPEECH_EXECUTION_PATCH_V2.schema.json)：2.1；新增字段严格校验。
- [首选L0示例](examples/plan-l0-baseline.json)：无表演参数的基线，不承诺自然度。
- [人工听感结论原文](第一批Spike人工听感结论.md)与[16项原始记录保留索引](evidence/batch1-record-manifest.json)。
- [本地测试结果](validation-results.json)及validation/命令日志。
- [完整文件清单](review/change-inventory.json)、[源码与运行资源完整Diff](review/runtime-and-source.patch)。

建议长度20加权字符（约10个汉字）、停顿80–200ms均为保守产品初始建议，不是官方限制，也未验证为最优。超过建议仍可在官方硬限内显式实验；L3默认禁止自动编译，需要Plan标注及软件本地用户确认，未测试能力不自动放开。

兼容性：协议升为2.1、Profile draft.3以避免静默改变旧语义。历史2.0/draft.2任务继续安全读取/试听/导出，原文件保留；执行/修复需要重新编译并确认当前版本的新任务。R1/R2设计包不覆盖。

UI当前已加入能力警示、复杂度/风险、发音完成度意图、实验确认与单变量Diff说明。诊断ZIP记录生产政策；软件不作声音评分或自行导演。本轮仅完成本地源码与构建验证，没有更新已安装绿色版或发布安装包。

本地：typecheck通过；178项tests、71项UI回归、53项repair2核心（与主套件重叠）及工作流UI通过；Electron原生文档、build、真实MP4打包检查通过。Windows10/实际多DPI未测。

下一步停在本包评审，等待用户确认。

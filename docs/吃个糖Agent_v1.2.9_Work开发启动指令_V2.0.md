# 吃个糖 Agent v1.2.9｜Work 开发启动指令 V2.0

以已经完成必要测试和 production build 的 v1.2.8 稳定源码作为唯一开发基线，直接开发 v1.2.9。

本次请以附件：

- 《吃个糖Agent_v1.2.9_真人口播_最终开发需求_V5.0.md》
- 《真人口播表演生产系统_使用手册_V5.0.md》
- 《ChatGPT_真人口播返回协议_V1.2.md》
- 《v1.2.9_安全稳定发布检查清单_V1.0.md》
- 三篇真实置顶台词
- 三份已提供真人音色参考

为唯一最新需求基线。

关键锁定：

1. 左侧「音频生成」上方新增完全独立「真人口播」；
2. 不改造、不替换原「音频生成」；
3. 不新增 LLM API、不部署本地 LLM；
4. ChatGPT作为外部导演/诊断大脑；
5. 软件实现“一键导出给ChatGPT”和“导入ChatGPT方案”；
6. ChatGPT→软件只执行严格 Runtime Schema；
7. Runtime Schema 是执行真值，📄 V5.0 与 🔒 V1.2 必须在 build 阶段校验版本同步；
8. 所有 Instruction 强制：
   - Han 字符 <= 40
   - API weighted count <= 100
   - Han=2，其余 Unicode code point=1
   - 不得使用 JS string.length
   - 超限禁止生成，禁止截断；
9. taskId/revision/exportId/contextHash/planId/planHash 防旧方案和重复执行；
10. 防双击重复生成；ambiguous timeout 不自动 retry；
11. confirmed 结果不覆盖；生成文件使用 revision；
12. 崩溃恢复 generating→interrupted，未知请求结果→unknown_result；
13. Beat 与 Generation Window 分离；
14. 小白听感诊断 + A/B + Repair History；
15. 同类问题最多三轮，之后升级诊断；
16. 三篇 Case1→Case2→Case3 真实 E2E 并人工 QC；
17. 真人口播任何 BUG 不得影响原音频生成。

开发原则：

最少假设、最小充分修改、Patch优先、优先复用稳定基础设施、不做无关重构。

开始前先读取真实代码与当前 CosyVoice 调用链；核对当前官方 API；不要按聊天猜实现。

不要先输出长篇计划，直接执行。

最终必须报告：

- 实际完成内容；
- Instruction 计数测试；
- 协议安全测试；
- 双击/超时/崩溃恢复测试；
- CosyVoice真实验证；
- 三篇人工真人感QC；
- 旧音频回归；
- production build；
- 源码/程序/发布包/SHA256位置；
- 哪些因外部条件未验证。

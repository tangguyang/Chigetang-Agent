# V2第一阶段交付与剩余验证

## 已开发

新首页为任务名称、复刻音色、Plan大文本框、导入校验；旧阶段一导演/自动选试演/按导演文字推参数已退出主流程。严格JSON Schema、重复键与Unicode、Profile版本/内容hash、文本覆盖、SSML范围、每Window至少一个只读intentRange、真实执行路径和锁校验已实现。

V2使用独立real-speech-v2/real_speech_v2.db。旧v1.2.9库通过SQLite readOnly打开；原音频从已有记录读取，不修改旧库、不自动转换旧导演协议。历史版本、原始WAV、请求快照、Plan修订、生成job/unknown状态均保留。

实现显式多锚点、逐段/多选生成框架、V1/V2...追加存储、时间倒序、A/B、选中版本、明确回滚、锁、Golden及FFmpeg最终拼接。新版本不覆盖旧文件，也不自动替换已有选中版本。Patch每Window输入、严格基线/版本/锁、Diff确认、仅目标更新、幂等；说明修订不建TTS任务，执行修改创建目标job。请求构建器仅读明确execution/SSML/hotFix，绝不读intentRanges或导演文字推导参数。

诊断全篇/单段/多选导出ZIP，含WAV、Plan、Profile快照、当前参数、实际请求与选中版本、反馈。软件不作声音判断。独立文档窗口non-modal、无parent、并开/复用、可调整窗口、永久顶部复制/关闭、完整Markdown复制、复制失败可见、崩溃/关闭隔离、位置恢复和越屏校正、安全独立preload已实现。

## 能力关卡

主体框架已开发，Profile/协议仍是R2候选。所有待Spike项保持PRODUCT_DISABLED_PENDING_VALIDATION；真实生成出口拒绝，不通过导入JSON解禁。离线模拟WAV测试证明工作流，不证明模型能力。全局参数、instruction、SSML/纠音等尚无真实云端证据，因此本阶段不会让这些请求上线扣费。

第一批16次候选请求见[批准单](第一批Capability-Spike批准单.md)，完整请求在resources/real-speech-v2/spike/batch1.json，批准模板approved=false。Case04故意越界放最后，正常预计15份音频。软件安全凭据配置见[API Key说明](API-Key安全配置.md)。

## 剩余未验证

- 第一批全部真实API接受/拒绝、加权100/101边界、克隆instruction、SSML组合、局部rate/pitch/sub/say-as/phoneme和两次seed复测：NOT_RUN。
- hot_fix（pronunciation及replace）、指令与局部多speak同时、局部参数反向/换序/极值、全局与SSML优先级、speak volume、更多phoneme/say-as：后续批准批次。
- 短语局部rate/pitch作为首版能力的适用范围、接缝代价、人物一致性：须实际证据与用户启用决定，不能只凭API接受。
- 多seed/多轮重生成的稳定性及真实账号计费/网络下载恢复：只有模拟故障测试，需付费批准后验证。
- Windows10实机、不同DPI/真实多屏热插拔、长任务强退/断电/磁盘故障：本轮没有这些硬件运行条件。Windows11已有native文档回归及越屏纯函数测试。
- 安装/便携包发布、完整Capability冻结、后续旧任务显式转换：本轮未发布。旧任务安全读取已提供。

真实付费API调用0。下一步等待你配置既有安全账户、选定音色并明确批准第一批；本轮不会自行测试。

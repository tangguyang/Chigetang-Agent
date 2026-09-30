# 增加 Provider / Model

1. 核对官方 Model ID、地域、Endpoint、输入媒体、组合约束、请求/返回、错误、价格、期限。保存资料链接与复核日期。没有证据的 capability 设 false。
2. 新 Provider 实现 `src/main/providers/adapters.ts` 中 ProviderAdapter：request 与 upload。通过 HttpClient 处理认证、HTTPS、429 和安全重试。不得将认证放到 React。
3. 实现 ModelAdapter 的 validateInput、uploadAssets、submitTask、getTaskStatus、cancelTask、getResult、downloadResult、estimateCost、getCapabilities、getErrorMessage。可继承 BaseAdapter。
4. 在 registry.ts 注册 factory。在 catalog.ts 添加 Provider 和 Model 的初始数据、capabilities.roles/parameters/limits、adapterVersion 与价格来源。已有用户数据库需要迁移或专门配置更新，不能静默覆盖用户价格。
5. UI 参数由 capabilities 定义生成。新模型沿用已有参数类型时无需重写页面。新增媒体角色或控件类型需要扩展共享 schema 与通用组件。
6. 在 validation.ts 添加必要的模型组合约束；最好提取到该模型文件。不要依赖显示名称判断协议。ModelType 已预留 video/image/audio/text，但本版本队列下载与播放器仍为视频；接入图像/音频时还需扩展结果 MIME 验证与展示。
7. 用协议 fixtures 测试字段、上传、401/403/429/5xx/超时/缺失 ID/状态解析；使用真实 SQLite 测试恢复和版本，不能仅测静态 JSON。
8. 获得用户授权后，用本机输入的 Key 做最小付费验收。把协议验证与真实端到端验证分开记录。

## 约定

submitTask 只返回云端 ID。若请求可能已受理而无法取得 ID，抛 SubmissionUnknown；不能自动再次 POST。getTaskStatus 将服务商状态映射成 pending/processing/succeeded/failed/cancelled/unknown，并保留原始 JSON。没有取消 API 返回 false，由 UI 告知官方控制台操作。

任务快照不包含明文 Key。轮询从 CredentialManager 按账户 ID 解密密钥。返回 usage 不等于账单金额，不要标记为 actual。没有官方余额接口不得制造余额值。

Wan 的媒体数组与 Seedance 的 content 数组由各 ModelAdapter 映射。HTTP 层不推断图像角色；任务引擎不认识特定 API 请求字段。

## v1.0.1 扩展点

新增 Provider 时实现 ProviderAccountAdapter，独立声明非付费连接测试和余额能力，未知余额返回 supported=false。不要用视频生成 POST 做隐式连接测试。

模型价格支持 Price.rules 条件表。使用 shared/pricing 统一预估，不在 React 或任务详情中重复实现公式。真实金额写 Task.actualCost，不能把 usage token 转换估算标为 actual。

新模型提交必须消费 shared/mentions 的绑定信息，并根据官方协议实现素材指代转换；资产数组顺序与编号必须共享同一来源。不要只正则替换 @Image1 文本后猜图片。

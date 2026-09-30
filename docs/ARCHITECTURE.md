# AI Video · 架构与需求决策

本文保留原架构说明。v1.0.5 新增音频工作台、独立数据根目录和能力矩阵，详见 ../HANDOFF.md 的代码地图。交付类型：Windows x64 待实机验收构建。

## 分层

React 页面只调用 preload 暴露的 IPC。主进程 Application 组合 TaskService、AssetManager、PromptManager、CredentialManager、DownloadManager、Logger、SQLite Repository。任务引擎通过 ModelAdapter Registry 获取 WanAdapter / SeedanceAdapter；模型适配器通过 AlibabaProvider / VolcengineProvider 处理认证、Endpoint、上传与 HTTP。UI 不持有网络客户端，密钥只在用户明确显示/复制时返回界面。

代码分区：

|位置|职责|
|---|---|
|src/shared/types.ts|统一模型、能力、快照、任务与 IPC Bridge 类型|
|src/shared/catalog.ts|经官方资料核对的模型初始配置|
|src/shared/brand.ts|名称、版本、品牌配置|
|src/main/models|模型协议转换、输入验证、适配器注册表|
|src/main/providers|认证、地域、HTTPS、上传、限流、HTTP 错误|
|src/main/services|任务、资产、Prompt、加密、下载、成本、日志、设置/项目服务|
|src/main/database|SQLite、迁移、事务、备份|
|src/renderer|React 七个页面、组件、主题、Zustand 草稿|

## 必须明确的需求冲突

1. 正式 API 能力优先于示例验收步骤。Wan 支持参考视频和产品图；Seedance 1.5 不提供参考视频。Seedance 2.5 视频输入当前需要可访问 URL，不能把本地路径直接提交。
2. 不能声称提交请求自动重试总是安全。付费 POST 的超时、5xx、缺失任务 ID 都可能已经创建云任务，因此暂停核对。明确 429、查询和上传可退避重试。
3. 价格受地域、分辨率、输入类型影响，未验证的价格不写入默认配置。任务持久化价格快照；未知费用保持未知，返回 usage 后仍为估算。
4. Portable 数据可移动，但 DPAPI 凭据绑定 Windows 用户/电脑。跨机必须重新输入 Key。
5. 云生成成功与本地下载成功是两个事实。状态 Completed + downloadStatus=failed 表示云成功、下载失败，可重下，不重提生成。
6. 相同参数再次生成不代表像素复现。随机种子 -1 表示抽样，官方也不保证完全确定性。
7. 模型关闭水印仅在官方参数支持时显示。没有自动余额接口时不显示编造的余额。

## 任务安全

每个任务组 tasks 拥有多个 task_versions。parent_task_id 和 parent_version_id 保留分支关系，UI 用顺序 V1/V2/V3 + 父版本展示。再次生成沿用旧模型定义、旧 Prompt、参数、资产绑定与账户元数据，但新任务使用提交时的价格快照和当前解密密钥。编辑生成可调整输入；独立复制清空父关系。

输入快照在事务中写入 task_snapshots，SQL trigger 拒绝 UPDATE。状态、云端 ID、错误、成本和结果在 task_versions 等表单独更新。下载用独占临时文件、同步写入、MP4 头检查和禁止覆盖的最终发布。移除任务记录仅软删除，不删除输出或资产。

队列计算全局、Provider、账户已在云端处理的任务量，轮询空闲期也计入并发。上传前重新计算 Hash，源内容变化会阻止提交。云任务已有 ID 时启动恢复查询；提交中断无 ID 时暂停，要求关联控制台 ID。没有自动抽卡或生成质量重试。

## 数据与性能

SQLite 使用 WAL、synchronous=FULL、事务、外键、busy_timeout。迁移按 PRAGMA user_version 递增；升级前备份，较新数据库禁止旧程序覆盖。手动备份使用 SQLite 在线备份 API。

资产以 SHA-256 去重；任务引用 Asset ID。复制导入属于程序管理路径，引用导入保留源路径。移动程序目录后对管理路径重新定位，历史快照原文保持不变。分页任务 30 条、资产/Prompt 40 条，缩略图缓存，避免全库渲染。尚未做万条真实媒体压力测试。

## UI 信息架构与设计系统

默认生成页：模型/Provider/账户 → 项目与素材 → 大幅 Prompt → 动态参数 → 保存位置 → 生成。右侧可折叠、可调整宽度的近期队列。其余页面为任务、资产库、Prompt、模型与 API、统计、设置。

浅色采用暖白、深灰与橙色强调；深色统一切换。CSS tokens 定义背景、文字、边线、强调色和圆角。Sidebar 固定导航，工作区保留大段文本空间，参数高级项默认收起。空状态、异步反馈、禁用按钮与模态原生焦点隔离已实现。

## 安全边界

Electron contextIsolation、sandbox、nodeIntegration=false；CSP、禁止外部导航/弹窗、拒绝网页权限；IPC 只允许自身窗口主 frame。媒体协议通过数据库 ID 解析路径，UI 不可任意读路径。API Endpoint 限制为对应官方域。日志不记录完整 Key/Prompt；原始 API 结果在落库前掩码当前密钥。

系统凭据服务不可用时拒绝明文回退。截图、Prompt 和源文件不会为了遥测自动上传；只有用户点击生成才将任务素材发送给所选 Provider。

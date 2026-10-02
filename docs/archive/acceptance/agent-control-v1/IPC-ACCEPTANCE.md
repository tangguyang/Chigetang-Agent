# Agent Control Interface：Windows IPC 单写入者版本

验收日期：2026-10-02。协议与 Capability Profile 不变。该版本替代“GUI 在线时 CLI 只能读”的第一版限制。

## 运行结构

```text
GUI 在线：Codex → 包内 chigetang.cmd → 原生 Windows Named Pipe
        → Electron 主进程 → SpeechAgentControl → 同一个 RealSpeechV2Service
        → Schema / Profile / Production Policy / Patch / 版本 / 数据库

GUI 离线：READ → 现有只读快照
        MUTATE/PAID → 取得唯一 writer 租约 → 现有独立 Service
```

GUI 在打开业务数据库之前取得 `config/agent-control-writer.lock` 进程级租约。独立 CLI 写入也必须取得这个租约。GUI 在线时 CLI 在创建 Service、读取凭据或开库之前先连接管道，所有业务操作均在主进程执行。GUI 启动与独立 CLI 竞争时，只有租约成功的一方可以成为写入者。

没有后台常驻第二个写库 Service。没有 HTTP、TCP listener、网络端口或远程访问功能。GUI 与 CLI 的 stdout envelope、Context Schema、命令、确认和校验保持一致。

管道元数据存在且 GUI 存活时，连接失败、身份不符、异常断线或超时都明确失败，**不会自动降级直写数据库，也不会自动重发**。GUI 正常退出清理桥与租约；异常崩溃保留租约，先检查进程、attempt/job 与账单后由操作者处理，不自动抢锁。

## 本机身份与安全

原生辅助程序 `dist/agent-control/local-pipe.exe` 只有帧传输功能，没有数据库、凭据或 TTS 代码。使用 Windows 系统自带 .NET Framework；随绿色包附带，无需额外安装 Node。

- 管道名：`\\.\pipe\chigetang-agent-control-v1-<24位实例hash>`，区分根目录与主进程实例。
- `CreateNamedPipe` 的 DACL 只授予当前 Windows 用户 SID，使用 `WindowsIdentity.User`，不授予整个管理员组或 Everyone。
- 显式设置 `PIPE_REJECT_REMOTE_CLIENTS`，拒绝远程 SMB 客户端。
- 连接后检查 `GetNamedPipeClientSessionId`，必须是 GUI 当前登录会话。
- 客户端使用 `GetNamedPipeServerProcessId` 核对原生管道宿主 PID，防止连到错误服务端。
- 初次建管道使用 `FILE_FLAG_FIRST_PIPE_INSTANCE`，同名被占用时失败。
- 每次请求有关联 ID、协议标记、数据根校验、参数/帧大小限制；服务端再次执行 parseArgs 和全部业务校验。
- API Key/Authorization/凭据不会返回。主进程凭据读取仅在内存登记脱敏值，继续使用原有 CredentialManager。

微软依据：[CreateNamedPipe / 远程拒绝标志](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea)、[客户端会话核对](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientsessionid)、[服务端 PID 核对](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid)。本轮未创建其他 Windows 用户或远程机器，跨用户/跨会话/远程拒绝由上述内核 ACL 与显式检查落实；未把同用户本机测试冒充跨账户实测。

## 命令与费用规则

沿用 [完整命令表](README.md#2-启动与命令表)：tasks、show、window、context、diagnose、versions、patch-preview、export-diagnosis、select、rollback、concat、patch-apply、generate。

GUI 在线时这些命令全部走桥。READ 无确认；select/rollback 不收费；concat 是本地拼接。generate 必须 `--confirm`，Patch Apply 沿用现有确认规则。实验配置仍需 `--experimental-confirm` 与配置级批准；管道身份不是付费批准。

```powershell
# 在最新绿色包目录内执行；GUI可以一直保持打开
.\chigetang.cmd speech tasks --json
.\chigetang.cmd speech context --task '<taskId>' --window GW002 --json
.\chigetang.cmd speech versions --task '<taskId>' --window GW002 --json
.\chigetang.cmd speech patch-preview --task '<taskId>' --file 'C:\本地目录\patch.json' --json
# 仅用户明确确认本次Diff和费用后执行；本轮未做真实生成
.\chigetang.cmd speech patch-apply --task '<taskId>' --file 'C:\本地目录\patch.json' --preview-hash '<本次hash>' --confirm --json
```

Patch Apply 已生成新版本时，不要紧接着另行 generate；后者是另一次生成动作。

## GUI 同步

IPC 执行后主进程发送现有 changed 事件。真人口播页面安全刷新任务列表与当前任务，保留未提交输入。原文件变更监听仍保留为辅助刷新。无需退出或重开 GUI。

## 绿色包实际验收

构建命令：`npm run pack:agent-control:win`；仅 Windows x64 绿色包，不调用安装器脚本。包内包括 `吃个糖Agent.exe`、`chigetang.cmd`、CLI 运行器、原生管道辅助程序、Schema/Profile 与现有运行资源。之前的绿色包不覆盖。

包位置由 `tmp/agent-control-package.json` 记录。实际包内验收命令：`npm run test:agent-control:portable`。证据目录为 `tmp/agent-control-ipc-acceptance/`，包含 report.json、transcript.json 和六张 GUI 截图。

验收直接启动包内 EXE，以当前真实 Golden Case Plan 原样建立临时隔离任务，保留原导演与生产规则。V1 复制现有 GW002 WAV，V2/V3 使用 fake adapter。隔离模式必须显式启动参数、有效夹具文件及指定 OS 临时目录同时成立，生产目录不能启用 fake。该模式的 Application fetcher 拒绝所有真实网络请求。

GUI 从启动到全部操作结束持续运行：

| 步骤 | CLI 与 GUI 验收结果 |
|---|---|
| tasks/context/versions | 成功，Schema 与离线一致，看到 V1 |
| 缺少 confirm | 拒绝，不创建新版本 |
| GW002 Patch Preview | 成功，只有 break 一个主要变量 |
| Patch Apply → fake Generate | 成功新增 V2；GUI 自动出现 V2 |
| versions | 倒序 V2/V1，旧 WAV 保留 |
| select V2 | CLI 与 GUI 当前版本均为 V2 |
| select V1 | CLI 与 GUI 当前版本均为 V1 |
| rollback V1 | 成功，V2 保留，GUI 无需重启 |
| 独立 generate | fake 新增 V3；GUI/CLI 均为 V3/V2/V1 |
| 结束 | GUI 正常退出，桥与 writer 租约清理；独立 CLI 只读/选择验证 |

生产真人口播文件清单及 SHA256 前后相同。真实云端请求 0、费用 0 元。没有 SQLite 并发写错误。测试只验证控制链和版本管理，不评价新声音自然度。

## 验证范围与下一步

新增原生 IPC 自动测试覆盖确认规则（含绕过CLI直接发IPC也拒绝未确认命令）、同一个 Service、跨进程 writer 排他、Patch 幂等、V1/V2、选择回滚、服务端 PID 不符拒绝、隔离模式生产根拒绝。保留全部现有 CLI/V2/UI 测试。包内实测机器为 Windows 11 专业版 10.0.26200；未把此次验证宣称为 Windows 10 真机验收。

本地结果：typecheck、build、bundle smoke 通过；完整自动测试 194/194；Agent 专项 15/15；UI 单元 71/71；V2 UI+SQLite+模拟 WAV 工作流通过。包内 EXE 与 chigetang.cmd 实测通过，GUI 同步有六张真实截图；正常退出后独立 CLI 读取/选择及 writer 释放也通过。生产真人口播目录 100 个文件前后清单与 SHA256 相同。

首次真实 `Codex → 包内CLI → GUI → CosyVoice` 联合实测尚未运行，必须另行获得用户明确批准。当前没有第二批 Spike、真实付费生成、导演或 Capability 变更。

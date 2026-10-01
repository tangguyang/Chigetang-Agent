# 吃个糖 Agent Control Interface V1（CLI）

交付日期：2026-10-01。源码功能，不是新绿色版；产品版本保持 1.3.0。

## 1. 架构与真实使用边界

```text
Codex / ChatGPT 理解用户需求并编写标准 Patch
  → scripts/chigetang.mjs（本机 CLI 运行器）
  → src/cli/{args,run,output}.ts（解析、确认、JSON、退出码）
  → SpeechAgentControl（与传输方式无关的受控命令入口）
  → RealSpeechV2Service（UI 与 CLI 的同一业务实现）
  → PlanValidator / Profile / Production Policy / buildRequest
  → 现有版本存储、音色账户绑定、CredentialManager、CosyVoice
```

CLI 没有自己编译 TTS 参数、诊断声音或解释 humanIntent 的代码。`window/context/diagnose` 返回同一结构化 Context。intentRanges 仅供 Agent 和用户理解，不进入请求构建器。Capability Profile、协议 Schema、Golden Case 导演内容均未修改。

只读及不收费的命令用 Node；已明确确认的 `generate/patch-apply` 用无窗口 Electron，复用现有 Windows safeStorage 凭据。不会构造 Application、启动调度器或创建 BrowserWindow。没有 HTTP Server，没有监听端口，也没有软件内部 LLM。

**现有绿色版尚未包含此次源码变更。** 它运行时只读命令可用，但 CLI 写操作及诊断导出会拒绝，避免旧 UI 与 CLI 并发破坏任务。请先正常退出该绿色版，或以后使用更新后的源码 UI。此次没有打包、启动或替换 EXE。已更新的源码 UI 使用共享任务锁和文件变更通知，外部新版本能刷新到现有页面。

## 2. 启动与命令表

环境：Node ≥24.19.0；已安装项目依赖。首次准备运行器：

```powershell
Set-Location 'D:\Codex\吃个糖Agent项目'
npm run build:cli
node scripts/chigetang.mjs speech --help
```

`build:cli` 仅构建源码运行器，不打包软件。命令本身不自动构建。项目已提供 `chigetang` bin 声明，但此次没有全局安装；本机直接使用上面的 Node 入口，或 `npm run speech -- ...`。

所有命令默认输出 JSON，也接受 `--json`。可用 `--data-root <目录>` 指定已有数据库；默认 `D:\吃个糖Agent数据库-v1.3.0`。不会自动创建或迁移生产数据库。

| 命令（均在 `speech` 后） | 必要参数 | 行为 | 云端费用 |
|---|---|---|---|
| `tasks` | 无 | READ：任务、voiceRef、Plan、revision、时间、Window 数、Golden | 无 |
| `show` | `--task` | READ：Plan、hash、版本、Window 配置与锁状态 | 无 |
| `window` | `--task --window` | READ：完整单 Window Context | 无 |
| `context` | `--task --window` | READ：Agent 上下文快照 | 无 |
| `diagnose` | `--task --window` | READ：结构化 Context；不诊断音质、不推导参数 | 无 |
| `versions` | `--task --window` | READ：时间倒序、当前选择、hash、路径、fingerprint、configRevision | 无 |
| `patch-preview` | `--task --file` | READ：严格校验、Diff、主要变量、目标、实验标志、previewHash | 无 |
| `export-diagnosis` | `--task --window` | LOCAL ARTIFACT：复用 UI 单 Window ZIP；不改任务 | 无 |
| `select` | `--task --window --version` | MUTATE：现有 mutate select | 无 |
| `rollback` | `--task --window --version` | MUTATE：回滚配置与选择；后续版本继续保留 | 无 |
| `concat` | `--task --confirm` | MUTATE：现有 FFmpeg 拼接与版本存储 | 无，不调用 TTS |
| `generate` | `--task --window --confirm` | PAID：只生成该 Window 的新版本 | 可能 |
| `patch-apply` | `--task --file --preview-hash --confirm` | PAID：现有 applyPatch；新 job 按原业务执行 | 可能 |

`generate/patch-apply` 的实验配置另须 `--experimental-confirm`，且现有配置级批准规则仍生效。`export-diagnosis` 可带 `--feedback`。`select/rollback/generate/concat/export-diagnosis` 可带 `--task-revision`，用于拒绝陈旧指令；未给时使用命令读取的当前 revision。Patch 自带 expectedVersions 与基线 hash，并必须带本次预览 hash。

## 3. 机器输出

stdout 恰好一条合法 JSON；stderr 放错误和运行器诊断。成功 exit 0，失败非 0：

```json
{"ok":true,"schema":"CHIGETANG_AGENT_CLI_RESULT_V1","command":"context","data":{"schema":"REAL_SPEECH_AGENT_CONTEXT_V1"}}
```

失败 envelope：`ok:false`、同一 schema、`error.code`、`error.message`。不输出终端装饰，不靠正则解析结果。未知/重复参数、非法 task/window、未确认付费动作、陈旧 Patch、锁保护等均退出非 0。

Context 包含 taskId/taskRevision、planId/planHash、protocol/profile 版本、voiceRef、Window 全部执行字段、configRevision、locked、当前版本、倒序历史版本、生成时配置、intentRanges、试演锚点、用户反馈、安全 attempt 状态、当前受信 Profile、任务 Profile 快照和生产策略。

历史版本没有 configRevision 时尝试从对应 attempt 读取，无法追溯则返回 null；不会编造或回写旧版本。`versions/context` 还使用 Service.output 检查原始音频路径及文件 hash。

## 4. 只读、并发与防重复扣费

原 Service 构造会创建目录、执行 DDL、切 WAL、恢复 submitting/running 状态，不能直接用于 READ。增加三种打开模式：

- managed：现有 UI 初始化与恢复。
- readOnly：私有临时快照打开，query_only；不恢复任务、不创建 job。
- existingWrite：CLI 仅打开已有库，无 DDL/迁移/启动恢复。

READ 不直接用 SQLite 打开生产数据库：`mode=ro` 在 WAL 模式下也可能创建源目录的 WAL/SHM。实现连续两次捕获相同的 DB+WAL 字节，最多尝试三组，在 OS 临时目录构建私有副本，由 SQLite 自身重建私有 WAL 索引。命令退出清理副本。源 DB/WAL/SHM、业务目录与音频的字节及目录结构保持不变。快照期间持续变化则明确拒绝，不猜测结果，不在活库使用 immutable。相关依据：[SQLite WAL 只读说明](https://sqlite.org/wal.html#read_only_databases)、[SQLite immutable 的不变性要求](https://sqlite.org/uri.html#uriimmutable)。

同一任务的写入和导出使用共享 `real-speech-v2/locks/<taskId-hash>.lock`，通过独占创建实现 UI/CLI/跨进程互斥。生成期间持有锁；读取另一个快照不会中断进行中的任务。预览仍检查任务空闲状态，Apply 重新校验完整基线、revision、目标版本和 previewHash。

崩溃留下的锁**不会自动删除或按超时抢占**。应先核对 PID 已退出、控制台账单、attempt/job 和已生成文件，再由操作者处理残留锁；CLI 本版没有自动修复/重发命令。结果未知继续遵守原来的核账边界。

同一 patchId 重复提交只返回既有结果，不再次 runJob；包括上次中断后遗留 queued job。失败请求不自动重试。新 WAV 使用新的版本路径；select/rollback 不删除任何版本。Golden/locked/原始文件 hash 的保护继续来自原 Service。

## 5. 凭据安全

只读命令不打开公共账户库，也不读取或解密 API Key。将来获批付费时，通过音色 voiceRef 读取原账户绑定、Workspace、cn-beijing Region；仍用现有 CredentialManager+Windows safeStorage，不新建密钥体系、不创建音色。

无窗口 Electron 只将现有 Chromium Local State 复制到私有临时目录，用于同 Windows 用户解密现有凭据。账户库只读打开；不保存、更新或导出账户。Key 只在调用过程中驻留内存，命令行不接受 Key 参数。

输出递归删除 Key、Authorization、凭据和加密字段，屏蔽已读取密钥、sk 类串、Bearer 和链接 token/signature。运行器 stdout 只转发唯一 envelope，stderr 独立脱敏。底层 HTTP 客户端已有响应/错误脱敏且 TTS 提交重试数为 0。

不要把 Key 放在聊天、源码、Markdown、JSON、PowerShell 命令或 Git。此次未解密真实 Key，也未运行付费入口。真实凭据解密及真实云端生成的联合验证留到用户明确批准后。

## 6. GW002 真实上下文 + 隔离离线验收

生产任务：`17c75363-aa5d-4fb4-9c97-eed84231d756`；音色引用：`941b677e-e7d9-4beb-a6a2-810c77d7be53`（现有黄明昊修正版）。读取时 GW002 为 L0、空 instruction、SSML 关闭；保留原始文本与导演内容。

候选只在膳食纤维、益生菌、西梅之后加三处 120ms SEMANTIC_PAUSE break。使用 L1/MEDIUM，无 instruction/rate/pitch/seed 联动，无实验能力。E0 表示明确 break 请求结构的执行路径，不代表听感保证；是否摆脱播音感仍未验证。

执行脚本：`node --experimental-strip-types scripts/agent-control-gw002-offline.ts`。它是开发验收脚本，只有复制/静音模拟 Adapter，没有云端路径。真实任务只读取 Context 与 Preview，Apply 及生成均在独立临时库。

本次结果：

1. 正式 GW002 Context 成功；源业务目录全量字节/文件清单比较不变。
2. 正式候选 Preview 成功，primaryVariables 为 `["break"]`，generateIds 为 `["GW002"]`，产生 previewHash；正式任务未 Apply。
3. 原 Plan 原样导入隔离库，V1 复制已有 GW002 WAV；V2 为模拟静音 WAV，不冒充 TTS。
4. 隔离 Patch Preview→Apply→新 job→V2 成功；其他五个 Window 状态不变。
5. versions 倒序为 V2/V1；select V2、rollback V1 成功，V2 继续存在。
6. 生产旧音频与隔离 V1 hash 未改变；生产目录仍不变；真实云端请求 0、费用 0 元。

本机证据在 `D:\Codex\吃个糖Agent项目\tmp\agent-control-gw002\`：`report.json`、`transcript.json`、`GW002-break-candidate.json`、`isolated-patch.json`。tmp 被 Git 排除；模拟 WAV 的独立目录见 report。候选是技术验收 Patch，需要你确认 Diff 后才可正式执行。没有声称音质已改善。

## 7. 本机真实命令示例

以下在项目根目录执行，不含任何 API Key。前三类是只读：

```powershell
$task = '17c75363-aa5d-4fb4-9c97-eed84231d756'
$patch = 'D:\Codex\吃个糖Agent项目\tmp\agent-control-gw002\GW002-break-candidate.json'
node scripts/chigetang.mjs speech tasks --json
node scripts/chigetang.mjs speech context --task $task --window GW002 --json
node scripts/chigetang.mjs speech patch-preview --task $task --file $patch --json
node scripts/chigetang.mjs speech versions --task $task --window GW002 --json
```

**以下 Apply 会生成付费请求，此次没有执行。只能在用户明确批准此次目标、Diff 和费用后使用。** 先退出不支持共享锁的旧绿色版；重新 Preview，以当前返回值为准：

```powershell
$preview = node scripts/chigetang.mjs speech patch-preview --task $task --file $patch --json | ConvertFrom-Json
if (-not $preview.ok) { throw $preview.error.message }
# 用户已确认这一份 Diff 后，才执行下一行
node scripts/chigetang.mjs speech patch-apply --task $task --file $patch --preview-hash $preview.data.previewHash --confirm --json
```

Apply 成功已经生成目标 Window。**不要紧接着再执行 generate，否则会多生成一版并可能再收费。** 独立 generate 示例仅在另外批准再生成时使用：

```powershell
node scripts/chigetang.mjs speech generate --task $task --window GW002 --confirm --json
```

查询 V1/V2、选择及回滚示例（对应版本必须实际存在；本次生产任务没有新增 V2）：

```powershell
$versions = node scripts/chigetang.mjs speech versions --task $task --window GW002 --json | ConvertFrom-Json
if (-not $versions.ok) { throw $versions.error.message }
$v1 = $versions.data | Where-Object versionNumber -eq 1
$v2 = $versions.data | Where-Object versionNumber -eq 2
if ($v2) { node scripts/chigetang.mjs speech select --task $task --window GW002 --version $v2.versionId --json }
node scripts/chigetang.mjs speech rollback --task $task --window GW002 --version $v1.versionId --json
```

## 8. 测试与交付

新增 Agent 自动测试覆盖用户要求的 17 类安全/业务断言，合并为 13 个测试场景，另测跨进程锁、WAL 未 checkpoint 数据、重复 Patch、陈旧 hash、未更新绿色版拒绝与 ZIP 兼容。

本地结果：在 Node 24.19.0 完整验证，npm test 192/192；UI 单元 71/71；旧修复回归 53/53；V2 UI+SQLite+模拟 WAV 集成通过（包含 CLI 新版本在 UI 刷新）；Windows 真实 Node CLI 子进程成功/失败码、唯一 stdout JSON、独立 stderr 通过；真实 GW002 隔离验收通过；typecheck、build、bundle smoke 通过。最后使用已构建的 CLI 读取真实 GW002 Context 与 Preview，对生产真人口播目录的 102 个文件做前后完整 SHA256/清单比较，结果不变。

测试仅模拟 TTS；本轮没有运行 Spike、真实 CosyVoice 或新 EXE。原数据和旧音频未迁移、覆盖或删除。已构建 `dist/cli/index.mjs` 与 `dist/cli/paid.cjs`，dist 为本机生成产物，不提交 Git。

## 9. 未来 Local HTTP API

后续路由可以直接调用 SpeechAgentControl.execute，复用确认、Service 校验、任务锁、结果过滤。可预留 tasks/context 的 GET，patch/preview、patch/apply、generate 的 POST；无需重新实现真人口播逻辑。

届时另行设计 localhost 绑定、来源/会话验证、显式一次性付费批准、请求限额与审计。当前没有实现这些路由，没有启动任何 Server，也没有宣称 CLI 的 `--confirm` 能验证自然语言授权：是否得到用户许可仍由调用的 Agent 负责。

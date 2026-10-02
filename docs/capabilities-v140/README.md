# 吃个糖 Agent v1.4.0 本地执行接口

2026-10-02。GUI与后台调用共用现有业务Service，新增CapabilityRegistry、JSON参数校验、顺序工作流和异步任务控制。Windows当前用户、本机会话Named Pipe保持单写入进程；无HTTP端口，无正式流程中的鼠标、键盘或视觉自动化。

## 绿色包启动

1. 解压整个绿色包。双击 `agent-start.cmd` 无窗口启动，或运行 `吃个糖Agent.exe` 使用GUI。两种模式共用同一个进程锁和数据目录。
2. 数据目录继续使用 `D:\吃个糖Agent数据库-v1.3.0`，版本升级不另建生产库。不覆盖旧版程序包。
3. 运行 `chigetang.cmd capability list` 获取完整能力定义，运行 `chigetang.cmd capability execute request.json` 执行。无需安装Node。
4. 后台启动后需要人工界面时，先在任务空闲时运行 `agent-stop.cmd`，再启动GUI。任务运行时停止接口会拒绝关闭。

```json
{
  "capability": "tools.audio",
  "params": {"path": "D:/素材/口播.mp4", "format": "wav", "directory": "D:/成品"},
  "confirm": false
}
```

返回外层CLI envelope（`ok/schema/command/data`），`data`是统一能力结果：`schema/executionId/capability/status/result/error/logs`。`status`为`succeeded/failed`。失败CLI非零退出；MCP返回`isError:true`。错误、返回数据均经过现有SecretFilter脱敏。

## 能力发现与参数

完整机器定义见 `catalog.json`，简表见 `API.md`。每项包含id、输入JSON Schema、统一输出Schema、Service入口和作用分类。后台文件输入必须明确给路径，不使用文件选择框。付费和删除动作必须在请求顶层使用`confirm:true`，仍须满足原Service的确认、锁、revision、previewHash和账户规则。不会自动补齐这些确认。

`params`中开放的复杂Draft、AudioGenerationConfig、Plan和Patch字段继续按原Service协议校验，相关类型见仓库`src/shared/types.ts`和`resources/real-speech-v2`。`tasks.create`及批量生成使用原有`requestId`；音色复刻不是天然幂等动作，建议统一通过`jobs.submit`执行。

## 长任务与重复提交

直接`execute`最多等待300秒；超时表示结果可能未知，不表示底层已取消。耗时工作用`jobs.submit`，然后用`jobs.status`查询。每个提交使用唯一的业务`requestId`，同一个id和完全相同请求只返回原job，不重复执行。相同id配不同请求会拒绝。请求指纹按JSON字段顺序计算，因此重发须保持原请求JSON。不要在结果未知时换新id重发。

```json
{
  "capability": "jobs.submit",
  "params": {
    "requestId": "extract-audio-20261002-001",
    "request": {"capability": "tools.audio", "params": {"path": "D:/素材/口播.mp4", "format": "wav"}}
  }
}
```

后台台账保存在`config/capability-jobs`，仅保存请求指纹、状态和脱敏结果，不保存请求参数或密钥。进程重启后未完成job标记`unknown`，先核对Service任务、成品和费用，禁止自动重放。写操作共享队列；状态读取可在执行中返回。后台进程退出时正在运行的业务由现有Service停止规则处理。

## 工作流

`workflow.run.params.steps`最多30步，每步`id/capability/params/confirm`。`{"$ref":"import.result.0.asset.id"}`引用前一步实际结果。预先拒绝未知能力、重复id、嵌套工作流、未确认收费动作和不带引用的非法参数。带结果引用的参数在取得实际结果后再次校验。失败停止后续步骤，返回已完成步骤；不回滚成品、不撤销云端费用、不自动重试。

`transcription.start`返回启动状态，`transcription.progress`查看进度，`transcription.wait`等待完成。串联流程使用`transcription.run`，其失败会使工作流停止。`tasks.create`、音频批量生成等原Service异步提交入口返回任务记录，需要继续查询`tasks.get`、`audio.history`等，返回成功不等于云端成品已完成。

Agent负责分析和编写脚本，再调用本机的执行能力。`text.process`是确定性的文本规范化，不包含软件内置LLM，也不声称自动完成文案分析。

## MCP与客户端连接

`chigetang.cmd mcp`提供stdio MCP（兼容2025-03-26、2025-06-18、2025-11-25协议版本），支持initialize、ping、tools/list、tools/call。能力id中的`.`在MCP工具名中变成`_`，例如`tools_audio`。工具参数是`{"params":{...},"confirm":false}`。stdout仅JSON-RPC，日志不混入协议。

包内`codex-mcp.example.toml`与`mcp-config.example.json`提供本包当前路径的配置。移动或重新解压包后，先运行`make-mcp-config.cmd`重建路径。将TOML配置合并到Codex配置，重新加载客户端后发现工具；后台进程须先启动。此版本不会自动修改用户Codex配置。

Codex官方MCP连接说明：https://learn.chatgpt.com/docs/extend/mcp?surface=cli

普通云端ChatGPT对话无法仅凭本机Named Pipe直接访问Windows服务。需要支持本机执行器的客户端，或另行配置有认证的远程连接/安全隧道。本版本交付本机stdio接口，没有开公网端口，没有配置ChatGPT账户连接，也未完成ChatGPT端实际调用验收。官方安全隧道说明：https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

## 验收边界

已覆盖业务执行入口：视频导入/生成/提音轨/抽帧/转换/裁切/拼接，音频生成/复刻/转换，转写、文本规范化、SRT输出，图片处理、素材检索、文件导出、项目、草稿、任务包、任务历史以及真人口播新旧Service。

以下保留人工管理：API密钥保存与显示、恢复出厂、目录/设置管理、系统回收站、剪贴板和打开文件/文档窗口。PDF转图片仍是原GUI渲染流程，尚未迁移为后台渲染能力。因此不能声称“所有GUI操作和全部功能均已通过后台验收”。

本次离线验收为独立OS临时库，网络被明确禁止，真实付费请求0。真实CosyVoice音质、音色复刻、各视频供应商成品、用户模型文件与ChatGPT端连接仍需真实联合验收。已注册接口不等于每个供应商都已实测。

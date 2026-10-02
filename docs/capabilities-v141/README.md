# v1.4.1 视频后台控制修复

版本保持 v1.4.x。本次没有新增视频模型、页面或安装程序。

启动仍保持单 writer：先判定 Electron 主进程，再取得数据库写入租约。已有 GUI 时，CLI/MCP 使用该主进程的 Named Pipe，不启动第二个 writer；已有 headless 时，用户启动 GUI 会看到明确的 PID 和空闲切换方法。

确认旧锁 PID 已退出时，程序先把数据库/WAL/SHM和旧锁记录保存在数据根 `config/writer-recovery/`，再恢复写入租约。恢复后队列暂停。请先核对异常中断任务及云端是否受理，再在 GUI 决定继续或取消；不要直接删除锁文件或强杀正在执行的主进程。

任务空闲时可运行绿色包内 `agent-stop.cmd`，然后启动 GUI。排队或正在执行的任务会阻止 stop；暂停队列并不等于这些任务已取消。

视频提交前准备使用现有 `tasks.create`，显式传 `deferQueue:true`。它复用 GUI 使用的 Service，创建真实 `Draft`，不会进入网络发送队列：

```json
{
  "capability": "tasks.create",
  "params": {
    "draft": "用 draft.new 返回的完整草稿对象替换此示例字符串",
    "requestId": "唯一且稳定的请求标识",
    "deferQueue": true
  },
  "confirm": true
}
```

示例字符串须替换成完整对象，不能原样执行。真实提交须另行批准；`tasks.resume` 可能重新入队收费，也要求 `confirm:true`。未知受理结果不能自动重发。

一键生成复用 `packages.import/update/preflight/confirm/submit`。路径导入无需 Windows 文件选择器；现有 GUI 和 Service 仅支持通过 update 修改 Prompt 和参数，素材绑定来自原任务包。不支持的 patch 明确拒绝。

一键复刻复用 `replica.import/update/preflight/confirm/submit`。`replica.compile` 复用既有本地任务编译器，生成的是一键生成协议 ZIP，不是 `chigetang.replica` ZIP。输出支持跨盘并校验 hash，已存在目标文件会拒绝覆盖。

`tasks.clone` 返回可编辑草稿。`independent:true` 再创建任务会得到独立任务组；GUI 的“再次生成”另走 `tasks.again`，保留版本关联。

生命周期入口 `tasks.get/list/refreshStatus/versions/children/cancel/redownload` 保持原 Service。缺少云端 ID 或输出 URL 时会明确拒绝查询或重新下载，不虚构 Completed 和输出路径。

最终包专项测试通过提交前控制、7组视频参数、独立复制、重启读取、MCP查询以及真实 ZIP 跨盘编译。202项回归测试通过。四条视频生产链整体均为 **PARTIAL PASS**；真实付费生成、下载的视频产物及 GUI 人工桌面观察尚未验收。

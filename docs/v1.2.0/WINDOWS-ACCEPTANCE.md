# 吃个糖 Agent v1.2.0｜Windows 构建与运行验收报告

## 状态 A：源码检查及测试

通过。完整结果见 `TEST-REPORT.md`。

## 状态 B：Windows x64 构建

通过。

- Electron 44.3.0 / win32 / x64。
- 产物类型：沿用源码既有配置的解压运行版，不临时增加安装器。
- 主程序：`吃个糖Agent.exe`。
- 静态核验：PE `MZ`、机器类型 x64、ProductVersion/FileVersion 1.2.0、应用图标尺寸、当前 dist 文件哈希、FFmpeg x64、MediaInfo WASM、许可证和 Windows 文件名碰撞检查全部通过。
- 程序包不含 `data`、`assets`、`projects`、`outputs`、`logs`、`backups` 用户数据目录，不覆盖真实用户数据。

## 状态 C：Windows 实际运行及业务验收

未验证，不能标记通过。

当前执行环境为 Linux，且没有 Wine、PowerShell 或 Windows 图形桌面，无法真实执行：启动软件 → 导入 ZIP → 预览素材 → 编辑 Prompt/时长 → 重新预检与估价 → 用户确认 → 非付费任务准备 → 退出重启。

以下项目也必须在独立 Windows 测试用户数据目录补验：

- 长视频工作台、左侧任务列表和四类任务 5 秒状态刷新。
- 三份文档导出、第一阶段自定义模板上传与恢复。
- 旧版账户、音色、素材、Prompt、历史任务及设置升级保留。
- 托盘、DPAPI、系统文件选择器、中文路径和正常退出重启。
- 真实《空腹理想体重》17 秒包；本轮附件只有合成媒体夹具。

未执行任何 Wan 付费任务。完成上述真机非付费验收前，版本状态保持 Candidate。

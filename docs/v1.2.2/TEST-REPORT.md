# 吃个糖 Agent v1.2.2｜自动化测试报告

日期：2026-09-22

## 已验证

- 单任务 V2.2 模板为协议 1.2.0，1 个 Segment 内准确映射 2 图、2 视频、2 音频。
- 多任务 V2.2 模板含 3 个 Segment，9 个段级素材绑定互不复用。
- `audio:true/false` 可通过协议校验、导入、更新并保留到任务草稿。
- 一键生成无历史任务包自动恢复，Prompt 只读，输出参数白名单包含 `audio`。
- 导入、清空、已提交包新轮次、安全预检及现有任务队列继续通过回归。

## 自动化结果

- TypeScript：通过。
- Node：95/95 通过。
- React/jsdom UI：59/59 通过。
- 真实媒体 bundle 冒烟：通过（MediaInfo 成功读取真实 MP4）。
- 生产构建与 Windows 静态包：通过；EXE 为 x64 PE，FileVersion/ProductVersion 1.2.2，应用文件哈希、FFmpeg x64、Windows 文件名和用户数据排除校验通过。

## 未声称

当前 Linux 环境未执行 Windows 真机启动、DPAPI、系统媒体设备或真实 Wan 付费生成；自动化成功不等于云端成片质量验收。

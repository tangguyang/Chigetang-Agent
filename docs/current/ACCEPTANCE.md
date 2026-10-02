# 当前验收入口

见 [v1.4.2 验收报告](../acceptance/v1.4.2-acceptance-report.md)。本地测试、原生IPC、绿色包结构、结果文件与FFmpeg验证构成非付费证据；不把 fake/offline 的 success 标成真实生成 PASS。

四项真实验收：参考生视频、一键生成、一键复刻、独立任务复制。每项仅获用户明确批准后运行一次，追踪真实taskId/Processing/Completed、下载MP4、验证size>0/ffprobe/时长/路径。UI人工听感和桌面交互观察独立记录，不虚构现场已完成。

最终真实验收更新：参考生视频、一键复刻、独立任务复制PASS，一键生成FAIL（本次任务包缺少Prompt素材引用，未付费提交）；实际生成调用3次。详见[真实生产报告](../acceptance/v142-real-production-report.md)，整体四链路未完全通过。一次性授权已消费，重启失效。

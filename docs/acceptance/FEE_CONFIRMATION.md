【v1.4.2 WAN3.0真实验收费用确认】

状态：继续暂停，等待人类明确授权。本轮真实 WAN / CosyVoice 付费 API 请求数：0。
现有账号：阿里云百炼，wan3.0-video，cn-beijing；API Key 与 Workspace 已存在。未更改账号、密钥、数据根或模型。
价格于2026-10-02重新查阅官方页面：北京480P原价¥0.30/秒，输入视频+输出视频按秒计费；不预先抵扣优惠或免费额度。余额/实际生成配额仍未知。

|链路|次数/片段|官方模型|最小验收参数|单次原价估算|
|---|---|---|---|---|
|A 参考生视频|1次|wan3.0-video|3秒参考视频，480P，输出2秒，9:16，audio=false|¥1.50|
|B 一键生成|1次/1个segment|wan3.0-video|同上|¥1.50|
|C 一键复刻|1次/1个GEN|wan3.0-video|同上|¥1.50|
|D 独立任务复制|1次|wan3.0-video|复制A真实完成任务后同上|¥1.50|
|合计|4次|||¥6.00|

固定duration、不采用智能时长、不新增Prompt优化。采用3秒参考素材以满足现有本地任务包编译约束；确切裁切与各链路预检将在授权后提交前完成。若参数或费用上升，先重新报告；失败/超时不自动再次生成。
输出位置：D:\Codex\吃个糖Agent项目\acceptance\v1.4.2-video-2026-10-02\outputs\paid-api-acceptance
计费按实际媒体秒数结算，估计不是最终账单。计划每条链路只生成一次；必须取得真实taskId、状态变化、Completed、下载MP4、大小>0、ffprobe可读、合理时长、存在的输出路径才可PASS。
官方来源：https://help.aliyun.com/zh/model-studio/wan3-0-video
计费公式：https://help.aliyun.com/zh/model-studio/model-pricing

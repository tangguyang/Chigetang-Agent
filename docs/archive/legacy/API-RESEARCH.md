# 官方 API 调研记录

复核日期：2026-09-15 至 2026-09-16。仅使用官方资料作为协议依据。模型访问权限和价格需以实际账户为准。

## 官方来源

- 阿里云 [Wan 3.0 API](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference)
- 阿里云 [临时文件上传](https://help.aliyun.com/zh/model-studio/get-temporary-file-url)
- 火山引擎 [创建视频生成任务](https://docs.volcengine.com/docs/82379/1520757?lang=zh)
- 火山引擎 [官方 Python SDK](https://github.com/volcengine/volcengine-python-sdk/tree/master/volcenginesdkarkruntime)

## 接入选择

|模型|官方 ID|输入策略|任务接口|
|---|---|---|---|
|Wan 3.0|wan3.0-video|图像 Base64；音视频临时 OSS；也支持用户提供的 HTTPS URL|/api/v1/services/aigc/video-generation/video-synthesis，/api/v1/tasks/{id}|
|Seedance 1.5 Pro|doubao-seedance-1-5-pro-251215|文字、首帧、首尾帧|/api/v3/contents/generations/tasks|
|Seedance 2.5|doubao-seedance-2-5-260628|参考图/音频 Base64；参考视频 HTTPS URL；首尾帧|同上|

Wan 使用业务空间域名与区域对应的 Bearer Key、异步头；输入媒体按角色映射，首尾帧不能与参考媒体混合，20,000 字符上限。智能时长、水印、声音和 Prompt 改写只提交官方支持参数。上传临时链接后开启 OSS 解析头。轮询默认 15 秒，结果/任务期限需及时下载。

Seedance 的 content 数组由 text 与带 role 的媒体元素构成。1.5 不提供参考视频槽；2.5 不显示 seed/Prompt enhance。视频需要可访问 URL，当前不假装本地路径是云素材。编辑/延长与首尾帧的组合约束由预检限制。软件保留长 Prompt，提示官方建议长度，不自动改写原文。

完整、机器可读的媒体数量、大小、尺寸、时长、参数枚举在 catalog.ts；联合约束在 validation.ts。UI 导入格式可能是官方允许格式的保守子集，未实现的格式不会直接放行。

## 未确证数据

没有将固定并发量当作账户配额。软件默认并发 2 是本地调度设置，实际云端限流会触发退避。未将 usage tokens 当作真实账单金额。没有硬编码价格、余额、积分或套餐；账户页只能显示手动备注。官方资料核对与真实生成验证是两个不同状态。

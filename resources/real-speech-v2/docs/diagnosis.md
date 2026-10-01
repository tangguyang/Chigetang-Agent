# 听感诊断：软件只打包

选择全篇、单Window或多选Window，填写你实际听到的问题和位置，导出诊断ZIP给ChatGPT。必须听实际WAV；未听到时只能按文本或用户反馈提出假设。

分别看选中音频的真实requestSnapshot和当前配置，不能把新配置误当旧音频的参数。原文、意图、Window范围、音色和profile一起提供。先针对一个主要问题提出修复，明确E0/E1/E2/E3及限制，返回REAL_SPEECH_EXECUTION_PATCH_V2。

Patch必须复制taskId、basePlanId/basePlanHash、targetWindowIds、expectedVersions与lockedWindows；不能猜hash，不能改非目标Window。每个Window至少一个intentRange，展示文字不能被软件用于自行生成参数。

用导演词典Ctrl+F搜索“平读”“句尾”“广告腔”“价格高潮”等。软件没有自动真人感评分，听感观察也不能替代API能力证据。

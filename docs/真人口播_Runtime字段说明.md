# Runtime Schema 附加定义（能力版本1）
字段类型以软件校验为准。Director/Execution示例见返回协议V1.2。
- pronunciation: [{"word":"纤姿咖","pinyin":"xian1 zi1 ka1"}]，仅word/pinyin。
- rhythmPlan/rhythmData: [{"unitId":"U001","pauseMs":180}]，0至2000毫秒整数。只在Unit尾部必要定点修正，禁止与自定义synthesisText同时使用。
- synthesisText: 非空纯文本，最多20000字符；不接受任意XML。
- transitionPauseMs: 0至2000整数。
- rate/pitch: 0.5至2；volume: 0至100整数；seed: 0至65535整数。
- changes.scope: TASK或WINDOW；speakerProfile/performanceArc仅TASK，targetId必须为taskId；其他字段仅WINDOW。
- seedPolicy: KEEP_IF_GOOD/FIXED/RANDOM。首版初始seed=0；不自动抽卡。需要更换seed时用Execution明确设置。
- energy: LOW/MEDIUM/MEDIUM_HIGH/HIGH；salesPressure: LOW/MEDIUM/HIGH。
- forbiddenStyles: NEWS_ANCHOR/CORPORATE_NARRATION/LIVE_SELLING_SHOUT/SCRIPT_READING。
- Director windows须顺序覆盖全部Unit且不重复，windowId为GW加至少3位数字。
- 联合修复目标为相邻完整Window，软件合并后连续生成；局部修复首版必须覆盖整个Generation Window。
- UPDATE_ONLY不请求TTS；NO_CHANGE不修改、不拼接；RECONCAT_ONLY只拼接；重生成计划应用后仍需点击执行，付费前可预览。

# CosyVoice 3.5 Plus Capability Spike｜设计方案 R2

状态NOT_RUN；没有云端调用和实测结论。必须在冻结Profile/Plan/Patch之前完成获批验证，不能修改正式业务源码。离线矩阵包含38个case、计划42次请求；这是完整候选清单，不是已获准预算，允许用户选择分批验证。所有fixture中的voice是占位符，不可直接发送。

## 要解决的问题

官方已明确支持连续多个speak及speak级rate/pitch，sub alias也是受支持元素。[官方SSML](https://help.aliyun.com/zh/model-studio/ssml-latex-user-guide)。待验证的是HTTP实际接受、组合后的声音变化、短语范围是否局部生效，以及接缝和人物连续性成本。官方支持不能直接推出口播适用；一次失败也不能直接写成MODEL_UNSUPPORTED。

## 分阶段矩阵

1. 先做只读预检：账号地域、模型名、同一现有复刻voice及targetModel、音频输出配置、当前HTTP字段尤其hot_fix格式，离线加权计数和XML解析。若字段需修订，先更新批准清单；本包fixture不构成请求正确性的云端证据。[HTTP API](https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api)。
2. 用户选定并批准最小连通/语法组：I00/I01、字符边界、S00、B、IS01、P00、SA01、PH01、SUB01、HF组。instruction边界覆盖ASCII99/100/101、汉字98/100/102、混合100、emoji组合；越界预期可能返回拒绝，仍可能收费，必须提前列入批准。
3. 再批准局部控制与听感组：P-rate/P-pitch mild、reverse、stress、order及priority、PSI01。轻度对照判断实用性，极值只作接口与变化证据，不作为产品建议。S00对P00区分并列根固有边界影响；P00对mild/reverse区分参数影响；order-flat对order-changed排除价格在第几段造成的误判。全局与SSML优先级不猜测，保留实际完整输入。
4. 再批准重复组R00/R01，各3次；输入含voice、model、text/XML字节、instruction、seed、hot_fix、language及输出配置必须完全相同。请求id等服务追踪项单独存储，不能误当模型输入。若样本数不足，结论只适用这些样本，不宣称模型全局确定性。

每组使用同一账号、现有voice和明确版本快照。费用预估以当前账号实际价格和所选请求为准；输入字符长度仅预估，不假定XML标签计费方式。真实usage、失败请求计费和账单是事后依据。价格与额度批准后变化或达到上限即停止；无自动重试，超时/unknown先核账。不得用免费额度存在作为免确认理由。

## 听感与声学记录

记录API是否接受、实际生效方向、范围泄漏、自然停顿、连说、重音清晰、音色一致、人物关系、接缝突变、句尾连续及整体可用性。盲听配对随机顺序，由老唐按具体句子描述改善/变坏/无差别，保存原始判断，不编造合格分或成功率。文本、voice、instruction一致的配对才可归因。

保留原始WAV、文件SHA256与解码PCM SHA256；文件hash不同可能只是容器头不同，PCM相同才是逐样本相同的强证据。记录总时长、短语位置、对齐方法；局部rate用同短语时长/音节密度作辅助，局部pitch用有声音帧F0分布辅助，剔除静默与无声帧，不能把语义变音或倍频错误当参数结果。不承诺精确倍率、恒定F0、固定时长或固定边界。

break组比较同标点自然停顿基线，报告额外变化与总间隙，不把自然静默算成请求插入量。sub听查是否读alias及是否保留周边内容；phoneme/hot_fix不仅验单词读对，也看无关位置是否受影响。instruction边界是格式测试，无语义的重复字符不用于声音优劣判断。

## 证据到启用决策

每项依次记录DOCUMENTED → API_ACCEPTED → EFFECT_OBSERVED → PERCEPTUALLY_USEFUL → 用户批准PRODUCT_ENABLED。步骤不可互相替代。多个speak局部rate/pitch若有效且自然度可接受，可进入首版明确范围控制；若只适合部分句式，记录经过测试的适用条件；若接缝代价过大，暂留PRODUCT_DISABLED_PENDING_VALIDATION并列出改善验证，不删除MODEL_SUPPORTED。不得以未运行作为首版不支持证据。

所有结果模板字段现在为空/NOT_RUN。测试输出未来放隔离目录，API Key只从受控环境读取，不写入JSON、日志、ZIP或请求导出。脱敏账号信息，下载链接按有效期管理；不污染现有任务库或生产业务代码。任何真实付费API调用前，用spike/付费调用批准单模板.md取得明确确认。Spike结束先交实际报告和逐能力决定，未批准冻结或正式开发则继续停止。

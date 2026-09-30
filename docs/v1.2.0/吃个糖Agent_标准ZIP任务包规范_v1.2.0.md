# 吃个糖 Agent｜ChatGPT 标准 ZIP 任务包规范 v1.2.0

本规范由软件共用的机器协议参数生成，不是独立的历史示例。当前协议：`schema_version: "1.2.0"`、`package_type: "chigetang.wan-task"`，应用版本 1.2.0。历史协议 1.1 接受不带 @ 的 bindings 且不支持 reference_order；历史 1.0 存在两种不一致的语法方言：全带 @ 的 bindings 可以含 reference_order；全不带 @ 的 bindings 不支持 reference_order。导入器明确识别这两种方言并拒绝混用；因尚未取得既有 Windows 程序的实际 17 秒包，不声称完成该程序的兼容实测。账户密钥和用户机器的绝对路径禁止写入 ZIP。

## 1｜硬约束及文件清单

- ZIP 根目录直接存放 manifest.json（UTF-8），全部路径为正常正斜线相对路径；禁止绝对路径、路径穿越、重复文件、软链接、ZIP64、加密及分卷。文件使用 STORE 或 DEFLATE 压缩。ZIP 压缩总上限 200 MiB；解压累计 500 MiB；单条 200 MiB；最多 500 条目。
- 素材最多 100 项，片段 1–60 段。ZIP 内除 manifest.json 外的**全部文件**均须由 assets[].path、segments[].prompt_file 或 documents.* 显式声明。优先最小执行包；无需提供分析或后期文件。完整克隆配音默认在 ZIP 外单独交付剪映。
- 真实素材存于 assets/；Prompt 存于 prompts/*.txt；声明的附加说明存于 analysis/ 或 postproduction/。禁止模糊识别文件名及凭空填写哈希。ZIP 导入器核验 CRC32 与每项素材实际 SHA-256。

## 2｜manifest 字段白名单

顶层必需字段：`schema_version`、`package_type`、`task_id`、`task_name`、`engine`、`assets`、`shared`、`segments`；可选：`documents`、`postproduction`。`engine` 固定为 wan3。task_id、素材 id、片段 id 必须为 ASCII 字母或数字起始，后接英文数字点下划线减号，长度≤101，任务名≤120字。

- assets[]：必需 `id`、`type`(image/video/audio)、`path`、`usage`(wan_reference/analysis_only/postproduction_only)、`sha256`(实际文件64位小写十六进制)。素材扩展名须与 type 匹配；只有 wan_reference 可绑定。
- shared：必需 `params`，可选 `bindings`。参数字段白名单与代码相同：`duration、audio、resolution、ratio、seed、watermark、prompt_extend`。duration 为整数 2–30 或 -1 智能，但段级 duration_seconds 为整数 2–30；audio 必须为布尔值，控制 Wan 是否生成声音（**不能用来去字幕**）；resolution 允许 480P/720P/1080P；ratio 允许 adaptive/16:9/9:16/1:1/4:3/3:4；seed 为 -1–2147483647 的整数；watermark/prompt_extend 为布尔值。当前模型可能进一步收窄合法时长，以实际预检为准。
- segments[]：必需 `id`、`order`(从1连续)、`prompt_file`、`duration_seconds`；可选 `bindings`、`source_range_ms`([开始毫秒,结束毫秒])，仅表示**本段原片来源元数据**，不指示导入器裁剪真实媒体。必须预先把确认区间实际裁成参考视频，并按参考文件的实际时长预检；本字段不能代替每段克隆音频绝对区间记录。
- documents 可选 timeline/composition，为已声明的实际文件；postproduction 可选 full_audio_asset_id（须指向 postproduction_only 音频）、segment_order（须与段顺序相同）。v1.2.0 **不支持 reference_order** 或其他未知字段。

## 3｜语义引用与参考槽位

当前 1.2.0 协议中，bindings 的键是不带 @ 的别名（`"person": "person.main"`），Prompt 文本中写 `@person`。支持中文标识符，但推荐 ASCII 别名；别名后加空格或标点，不将紧贴其后的中文/英文误识别为独立引用。`@@` 表示普通字面 @。内置标准别名**严格区分大小写与类型**：`person` / `product` → image；`motion` → video；`voice` → audio。`Person` 等大小写不一致拒绝；其余合法自定义别名按实际素材 `type` 分配参考槽位，可与标准别名并存。未绑定、拼写不一致、声明未使用、类型或 usage 错误均拒绝。共享绑定可在每段由同名别名覆盖，每段分别生成真实 @ImageN、@VideoN、@AudioN 槽位；不会把第一段视频/音频暗中复用到其他段。若确实打算复用，须明确绑定同一素材 ID。不得在本版新包写 reference_order。

## 4｜可执行格式示意（哈希占位，**不是可导入 ZIP**）

```json
{
  "schema_version": "1.2.0", "package_type": "chigetang.wan-task",
  "task_id": "replace-with-new-unique-id", "task_name": "访谈复刻", "engine": "wan3",
  "assets": [
    {"id":"person.main","type":"image","path":"assets/person.jpg","usage":"wan_reference","sha256":"请填写真正文件的64位小写SHA256"},
    {"id":"motion.001","type":"video","path":"assets/motion.mp4","usage":"wan_reference","sha256":"请填写真正文件的64位小写SHA256"},
    {"id":"voice.001","type":"audio","path":"assets/voice.wav","usage":"wan_reference","sha256":"请填写真正文件的64位小写SHA256"}
  ],
  "shared": {"params":{"duration":17,"ratio":"9:16","resolution":"1080P","audio":false,"seed":-1},"bindings":{"person":"person.main"}},
  "segments": [{"id":"segment_001","order":1,"prompt_file":"prompts/001.txt","duration_seconds":17,"bindings":{"motion":"motion.001","voice":"voice.001"}}]
}
```

prompts/001.txt 示例：`参考 @person 保持同一人物；按 @motion 的本段动作与 @voice 的节奏配合，禁止字幕和屏幕文字，手部无美甲、长指甲、戒指、手镯或手链。` 实际文件需保留用户确认的镜头时间表与具体动作。**另随交付提供的真实示例 ZIP 才可执行**；不得直接使用上方占位值。

## 5｜参考预算、负例与非付费校验

每段实际参考视频（可能多条）总时长 ≤15 秒且与本段生成时长合计 ≤30 秒；参考音频按音频自身限制单独核对。生成时长还须经当前 Wan 模型实际 `durationOptions`/媒体预检，不能只依赖 manifest 的 2–30 范围。`audio` 仅控制 Wan 是否生成声音，不是去字幕开关。`source_range_ms` 不执行裁剪；参考视频及每段对应音频须在打包前制成真实片段。


应拒绝：bindings 键写 `@person`；未知 `reference_order`；未声明的 analysis 文档；SHA-256 不符；素材缺失；`../` 路径；混淆 audio 与去字幕；跨段绑定错误；新协议未知字段。导入通过不代表可付费：必须可视化检查 → 核对 Prompt 和真实支持的参数 → 当前修订号重新预检、估价 → 用户明确确认（改动冻结时长要重新确认）→ 安全受理后才进入已有任务队列。部分受理或未知时禁止自动重试。

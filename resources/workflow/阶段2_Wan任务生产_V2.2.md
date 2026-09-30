# 吃个糖 Agent｜阶段2：Wan任务生产 V2.2

## 输入与目标

输入必须是用户已确认的《阶段1_复刻方案核对稿.md》和其中列明的真实素材。本阶段只将冻结方案转换为 Wan 执行任务，不重新创作，不替换素材，不改素材 ID 或别名。

## 协议边界

- 目标软件为吃个糖 Agent v1.2.2，任务包机器协议仍为 `schema_version: "1.2.0"`。
- 不得自创 manifest 字段、数组绑定或新目录结构。
- `bindings` 是“别名→单个素材 ID”的对象；多图、多视频、多音频必须使用多个唯一别名。
- `bindings` 键不带 `@`；Prompt 中引用时必须带 `@`。

## Segment 任务表

为每个 Segment 输出：

| Segment | 原片区间 | 输出整数时长 | 素材绑定 | Prompt引用 | 声音 |
|---|---|---:|---|---|---|
| segment_001 | 【毫秒起止】 | 【秒】 | person→person.01；person_side→person.02；motion→motion.01；voice→voice.01 | @person @person_side @motion @voice | true/false |

必须满足：

```text
assets 中的素材声明
=
当前 Segment 合并 shared.bindings 后的绑定
=
当前 Prompt 中的 @别名引用
```

- Prompt 中的每个 `@别名` 都必须有绑定。
- 每个已绑定别名都必须在当前 Prompt 中使用。
- 多 Segment 可复用同一素材 ID，但必须明确写出；不得默认沿用上一段。
- 自定义别名按素材真实类型自动进入 `@ImageN`、`@VideoN`、`@AudioN`，不在 Prompt 中手写 Wan 槽位号。

## Prompt 要求

每段 Prompt 必须包含：

1. 所有当段素材 `@别名`。
2. 人物、产品、场景、景别、镜头和光线。
3. 从本段 0 秒开始的动作、手势、眼神、表情、停顿和情绪轨迹。
4. 真实皮肤、眼睛、眼镜、手部及身份一致性要求。
5. 禁止自动字幕、屏幕文字、额外 Logo 和水印。

不写逐字台词。参考视频存在烧录文字时，必须在生产前换成无字版或完成可验证的去字处理；负向 Prompt 不是去字保证。

## 参数与预检

- `duration_seconds` 为 2–30 的整数，小数向上取整；还必须符合当前 Wan 模型实际可选时长。
- `audio` 必须是布尔值：`true` 表示请求 Wan 生成声音，`false` 表示关闭 Wan 声音；它不是字幕开关。
- 参考图片最多 10 张；参考视频最多 5 段且总时长不超过 15 秒；参考音频最多 5 段且总时长不超过 15 秒。
- 每段参考视频总时长＋输出时长不超过 30 秒。
- 声音开关、分辨率、画幅、Seed、水印和 Prompt 扩写必须使用用户确认值。

## 交付与状态

交付《阶段2_Wan任务表.md》，包含全部 Segment、真实素材清单、bindings、完整 Prompt、参数和逐段预检结果。通过后标记 `WAN_READY`，交给阶段3。

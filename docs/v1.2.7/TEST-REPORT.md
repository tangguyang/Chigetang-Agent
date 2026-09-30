# v1.2.7 本地验证

使用真实 8 秒合成视频与配音，裁切两个 3.5 秒 GEN，核验参考视频不同、音频素材逐段不同、时间表存在，生成 ZIP 可被既有生产解析器读取。未确认方案及超出 15 秒 GEN 被拒绝。

`npm test` 99/99 通过；`npm run test:ui` 66/66 通过；TypeScript 类型检查、生产构建与真实 MP4 的 MediaInfo bundle 检查通过。Windows 包结构结果见最终交付。本轮不调用收费 Wan API；Linux 包检查不等于 Windows 真机启动。

# Third-party notices

AI Video uses Electron 44.3.0, React 19.2.4, React DOM 19.2.4, Zustand 5.0.3, Lucide React 0.468.0, and mediainfo.js 0.3.7 / MediaInfoLib 25.10. Notices are included in licenses/. Chromium and Electron runtime notices are also shipped as LICENSE and LICENSES.chromium.html in the portable directory.

Media metadata is processed by the unmodified WebAssembly build distributed by https://github.com/buzz/mediainfo.js (BSD-2-Clause), based on https://github.com/MediaArea/MediaInfoLib. Source and build instructions are maintained at those upstream repositories. It is bundled locally; no media is uploaded for metadata extraction.

The npm package lock records all build-time dependencies. Development dependencies are not included in the application runtime. This distribution does not include ffprobe-static or the old FFmpeg executable used during early development.

## v1.0.5 — FFmpeg 独立可执行文件

Windows 包附带 FFmpeg 6.1.1 essentials build，由 Gyan 构建，经 ffmpeg-static b6.1.1 发布。作为独立进程用于格式转换和封面提取。未经修改。

- 二进制来源：https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- FFmpeg 上游源码：https://github.com/FFmpeg/FFmpeg/commit/e38092ef93
- 构建项目：https://github.com/eugeneware/ffmpeg-static
- 原始许可证及构建配置：licenses/FFmpeg-GPL-3.0.txt、licenses/FFmpeg-Upstream-README.txt


## 本地转文字新增运行时

- sherpa-onnx v1.13.8，官方 Windows x64 static MT Release CLI；Apache-2.0。
  来源：https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8
  随包许可：licenses/sherpa-onnx-Apache-2.0.txt。
- 静态链接 ONNX Runtime 及其依赖；许可与第三方声明见 licenses/ONNX-Runtime-MIT.txt、licenses/ONNX-Runtime-ThirdPartyNotices.txt。
- SenseVoice 2024-07-17 INT8 模型由用户单独安装，不包含在程序包里；模型目录保留在用户数据根目录。

## v1.2.8 本地 PDF 转图片
pdfjs-dist 5.6.205 (Mozilla PDF.js), Apache-2.0. License: licenses/PDFjs-Apache-2.0.txt.
运行包仅需构建后的 PDF.js、worker、cmaps、standard_fonts 和 wasm。本地画布由 Electron 提供；测试环境的 @napi-rs/canvas 与浏览器不作为新增产品依赖。
测试样本 tests/fixtures/中文多页.pdf 嵌入 Noto Sans SC 子集字体（SIL Open Font License 1.1），许可证见 licenses/TestFont-OFL.txt。

## v1.2.9 独立媒体校验
新增独立Windows ffprobe.exe，来自FFmpeg官网列出的BtbN构建，未修改，以子进程读取本地WAV元数据。未更换原ffmpeg.exe。
来源与文件SHA256：resources/docs/ffprobe-来源.json；GPL许可：licenses/ffprobe-LICENSE.txt。
构建项目及源码获取：https://github.com/BtbN/FFmpeg-Builds ，https://github.com/FFmpeg/FFmpeg 。

## 真人口播 V2严格协议校验

Ajv 8.20.0（MIT）及其运行依赖fast-deep-equal（MIT）、fast-uri（BSD-3-Clause）、json-schema-traverse（MIT）、require-from-string（MIT）打包于主进程，仅编译内置受信JSON Schema，不编译导入协议提供的Schema。对应原始许可证见licenses/*-LICENSE.txt。

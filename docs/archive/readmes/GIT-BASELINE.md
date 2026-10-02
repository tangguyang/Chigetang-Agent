# Git 基线说明

本仓库以“吃个糖Agent v1.2.9 修复版完整源码”为首次 Git 基线，建立日期 2026-09-30。

## 版本管理原则

- `main`：只保留经过验证、可作为下一次开发起点的稳定源码。
- 每次功能开发使用独立分支，验证后再合并到 `main`。
- v1.2.9 是 Git 化之前的首个源码基线；后续版本不再依赖手工保存“最终版 ZIP”作为唯一版本记录。
- API Key、用户数据库、真实用户素材、生成结果和本地缓存不得提交。

## 不进入普通 Git 的大型运行时

以下文件来自原始 v1.2.9 源码包，但不放入普通 Git 历史：

- `resources/ffprobe.exe`（约 168 MB，超过 GitHub 普通 Git 单文件 100 MB 限制）
- `resources/ffmpeg.exe`（约 83 MB）
- `resources/sherpa-onnx/sherpa-onnx-offline.exe`（约 19 MB）
- `dist/`（可重新构建的产物）
- `node_modules/`（由 `package-lock.json` 重建）

源码仍通过环境变量、系统 PATH 或本地 resources 目录使用这些运行时。正式做可复现发布时，应将大型运行时放入 Git LFS、Release 资产或构建下载步骤，而不是复制进普通源码提交。

## 安全

初始化前已检查常见 API Key / Access Key / Secret 模式；源码中没有发现真实凭据。测试中出现的 `sk-complete-secret` 是测试夹具字符串，不是真实密钥。

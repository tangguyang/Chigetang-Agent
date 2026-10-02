# v1.2.5 本地验证报告

## 验证范围

- 基于上传的 v1.2.4 转文字源码创建独立开发副本，保留数据库协议和内置任务包格式。
- 定向测试覆盖：14.8 秒真实 WAV 保持完整、20 秒真实 WAV 拒绝，缺省 `prompt_extend` 编译并发送 `false`，显式 `true` 警告，草稿恢复失效确认，未知提交状态不可重试，逐段素材与编译 Prompt 核对。
- `npm test`：98/98 通过；其中新增 v1.2.5 定向测试 3 项。
- `npm run test:ui`：65/65 通过；`npm run typecheck` 通过。
- `npm run build` 通过；`npm run test:bundle` 使用真实 MP4 验证打包后的 MediaInfo，通过。
- Windows x64 包复用校验和为 `4c9faf7e0d362df6f6bebf24a1597f5d0e103e004befc7b1f78a1ed89260af40` 的 v1.2.4 基础 Electron 运行时，替换为本次构建文件及资源，更新 EXE 版本至 1.2.5。`scripts/verify-package.mjs` 检查 PE、版本、图标、FFmpeg 和内置文件哈希，通过。

## 实际边界

本测试不调用真实 Wan 收费 API。Linux 构建可验证 Windows x64 便携包 PE、嵌入文件、图标、版本及包完整性，不等于 Windows 10/11 真机启动验收。转写模型需要按原版说明单独安装；本补丁未改动转文字功能。

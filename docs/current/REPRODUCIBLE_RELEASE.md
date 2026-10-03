# v1.4.2 可复现 Windows x64 发布

## 基线与环境
源码权威基线是 GitHub tangguyang/Chigetang-Agent 的 dev；package.json、VERSION 均为1.4.2。
要求 Windows x64、Git、Node >=24.19、npm、系统 tar.exe/curl.exe、.NET Framework 4.x 的 x64 csc.exe。
构建 nativePipe 使用 Windows .NET 编译器；不需要 Python、额外 VC++ 安装或真实 API 账户。
不要在正在运行本仓库 dist 的程序旁构建；使用独立源码目录，避免 local-pipe.exe 被占用。

## 从源码重建
```powershell
git clone --branch dev https://github.com/tangguyang/Chigetang-Agent.git
cd Chigetang-Agent
npm ci
npm run prepare:runtime
npm run verify
npm run test:release
npm run pack:win
npm run verify:package
```
绿色包位置记录在 tmp/agent-control-package.json；验证报告位于 tmp/package-verification.json。
测试数据使用隔离 AIVIDEO_TEST_ROOT。所有验收都不得调用真实付费 API 或生产数据库。

## 固定运行时
锁定清单是 scripts/windows-runtime-lock.json，同时固定下载地址、压缩包 SHA256、解压成员路径与最终 EXE SHA256。
- FFmpeg：Gyan 6.1.1 essentials，保留现有已验收二进制。
- ffprobe：BtbN 2026-09-29 / N-126965-gd85cdd2597，保留现有已验收二进制。
- sherpa-onnx：上游 v1.13.8 Windows x64 static MT，输出至程序实际读取的 resources/sherpa-onnx/sherpa-onnx-offline.exe。
- Electron：44.3.0 Windows x64 ZIP，校验固定官方 SHA256；打包复用缓存，避免重复下载。
二进制不进入普通 Git。准备脚本校验已有文件；哈希不符即停止，不覆盖、不自动升级。
新下载文件先校验压缩包，再解压校验 EXE SHA256 与 x64 PE。打包前再次校验，缺失或损坏拒绝打包。
来源：[Gyan 6.1.1](https://github.com/GyanD/codexffmpeg/releases/tag/6.1.1)、[BtbN 固定构建](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-29-13-10)、[sherpa v1.13.8](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8)。

默认下载缓存为 cache/windows-runtime；可设置 AIVIDEO_RUNTIME_CACHE 使用共享离线缓存。
缓存名、归档格式和 SHA256 由锁定清单决定。上游删除文件时不能回退 latest，应先保留原文件并经授权发布同哈希镜像。
当前还没有本项目托管的固定 Runtime Release 镜像。尤其 [BtbN 保留政策](https://github.com/BtbN/FFmpeg-Builds#release-retention-policy) 只保留最近14次日构建和每月最后一版两年；当前 ffprobe 的9月29日日构建不保证长期保留。必须保存同哈希归档缓存，后续将其镜像到本项目固定 Release Asset，不能借此升级运行时。
当前已验证纯净源码目录可重建，但在永久镜像完成前，不能宣称任意未来日期无缓存首次下载都能成功。

## 包验证与边界
verify:package 检查 Electron x64 PE/版本/图标、dist 文件哈希、工作流资源、三个固定 Runtime 与许可、用户数据目录不存在。
当前 package-win 转交统一 package-agent-control-ipc；Node modules 不进入最终应用目录。
SenseVoice model.int8.onnx 与 tokens.txt 仍需用户按模型指南独立安装；不是绿色包内置模型，校验值见 resources/sherpa-onnx/model-checksums.json。
Electron和npm依赖仍需相应下载源可用；锁定依赖不等于永久离线可用。
本流程保证源码与固定依赖可重建包内容，不承诺带时间戳的 PE、输出目录和整个压缩包逐字节相同。
静态包验证不能替代 GUI 人工体验、真实音色质量或付费服务验收。

## main / dev 同步
本次核对时 main 是 v1.2.9（6492f2b），为 dev 的祖先，落后51个提交；dev 为v1.4.2。
main 同步前重新 fetch 核实祖先关系，经 Review 后用 git merge --ff-only origin/dev 快进，再正常 push main。
若 main 后续产生独立提交，停止快进方案，审查后正常 merge；禁止 rebase、force push、reset --hard。
本任务仅维护 dev，未修改 main，也未自动推送。

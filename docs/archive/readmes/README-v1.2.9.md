# 吃个糖Agent v1.2.9 候选版本（待真实声音验收）

本版本以用户上传的v1.2.8源码为基线。新增真人口播独立工作台，旧音频生成及旧视频链路保留。完整验证记录以docs/archive/acceptance/v129/测试报告.md为准。历史版本文档继续保留，不能当作本版验收结论。

## 使用
退出旧版后，安装Setup.exe或解压Windows-x64.zip；绿色版双击吃个糖Agent.exe。旧用户数据目录保留，真人口播数据另存real_speech.db。
进入“真人口播”，新建任务、选现有音色、粘贴台词、导出给ChatGPT、导入方案并确认预览。先8–15秒试演并确认听感，再生成全文、拼接、填写诊断。
下载失败优先恢复下载，避免重复生成计费。未知结果先核对云端计费；软件不自动重试。

## 当前验收边界
程序构建和自动测试与真人听感验收分开。没有在本环境接入用户真实API和Voice ID，三篇台词未生成真人Golden Sample。Windows安装和原生桌面运行未实测。
该候选包不应被描述为V5.0全部完成、正式验收通过或“无BUG”。

## 开发复现
Node.js 24.19.0，npm ci、npm test、npm run test:real-speech、npm run test:ui、npm run build、npm run test:bundle。
媒体测试需本地FFmpeg/ffprobe。npm run pack:win制作Windows包。python scripts/build-installer.py <makensis>生成NSIS安装包。
原冻结brand.ts内部版本1.2.3按v1.2.8哈希锁定保留；对外包与新增模块版本为1.2.9。

## 2026-09-30 修复版

本次实际交付为 Windows x64 绿色版和源码，版本仍为1.2.9。新入口与操作以v1.2.9-Release-Notes.md、v1.2.9-Upgrade-Guide.md及docs/archive/acceptance/v129-repair/测试报告.md为准。

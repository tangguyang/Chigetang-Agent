# 吃个糖 Agent v1.2.9 修复版2

2026-10-01。本次从 dev 现有实现继续修复，没有重做旧模块或升级版本。

先读 `docs/v129-repair2/IMPLEMENTATION-STATUS.md`、`ACCEPTANCE-RESULTS-2026-10-01.md`、`DEVELOPMENT-AND-RECOVERY.md`。

本地完整回归156/156，通用UI71项，口播核心/媒体53项，以及DOM和Windows Electron模拟音源的五条黄金路径通过。Windows x64测试包已生成。真实付费声音、生产IPC全链路与交付包独立启动仍需现场验收，不能把此包描述为完成真实听感验收的正式发布版。

开发：Node24.19+，`npm ci` → `npm run verify` → `npm run test:repair2` → `npm run build`。Windows额外执行 `npm run test:repair2:windows` 和 `npm run pack:win`。大型运行时从现有安装包校验恢复，参阅开发与恢复说明。

真实音色/密钥必须由用户配置。不要删除已有数据根或数据库。最终Git SHA、ZIP SHA-256和文件大小见交付目录的 FINAL-DELIVERY-REPORT.md 与 SHA256SUMS.txt。

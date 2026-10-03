# 本地开发

Node >=24.19，npm ci 安装锁定依赖；npm run typecheck；npm test；npm run test:ui；npm run test:bundle；npm run test:repair2；npm run test:repair2:windows；npm run test:real-speech:v2；npm run test:capability:runtime。

绿色包：npm ci → npm run prepare:runtime → npm run verify → npm run pack:win → npm run verify:package。环境、固定运行时、离线缓存和包验证边界见 [可复现发布](REPRODUCIBLE_RELEASE.md)。必须在隔离数据根运行最终绿色包，禁止用生产账号执行测试。打包资源不包含数据库、凭据、源码或 node_modules。

清理脚本默认 dry-run：scripts/maintenance-v142.py 盘点；scripts/cleanup-v142.py 输出清单，仅 CTG_CLEANUP_APPLY=yes 执行。历史交付和真实素材保留。脚本仍在原位置以保持 CI/测试引用稳定。

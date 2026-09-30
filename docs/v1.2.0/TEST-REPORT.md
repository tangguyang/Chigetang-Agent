# 吃个糖 Agent v1.2.0｜R4 最终自动化测试报告

日期：2026-09-21  
基线：`吃个糖Agent-v1.2.0-R4-CANDIDATE-Source(2).zip`  
输入 ZIP SHA-256：`6606566c0d0b83c4af5d6bf2f1baa3a5124695020ec9680454f3d5c2a2bc6798`

## 结论

- 状态 A（源码检查及测试）：通过。
- 状态 B（Windows x64 构建）：通过；已生成解压运行版并完成 PE x64、版本资源、当前构建文件哈希、FFmpeg x64、用户数据目录排除及 ZIP CRC 检查。
- 状态 C（Windows 实际运行及业务验收）：未执行。当前环境为 Linux，未提供 Wine、PowerShell 或真实 Windows 桌面；不得据此宣称正式稳定版。
- 未调用 Wan 或其他付费 API。

## 实际环境

- Linux x86_64
- Node.js `v24.19.0`（满足 `engines >=24.19.0`）
- npm `11.9.0`
- `npm ci`：成功，按现有 `package-lock.json` 安装 238 个包。

## 实际命令与结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 通过，0 错误 |
| Node 全套回归 | `npm test` | 91/91 通过 |
| UI 单元检查 | `npm run test:ui` | 59/59 通过；jsdom，非 Windows 视觉测试 |
| MediaInfo 打包冒烟 | `npm run test:bundle` | 通过；打包模块读取真实 MP4 成功 |
| 汇总验证 | `npm run verify` | 退出码 0 |
| UI、主进程、预加载构建 | `npm run build` | 通过；Vite 1611 modules transformed |
| Windows x64 打包 | `npm run pack:win` | 通过；Electron 44.3.0，`release/吃个糖Agent-win32-x64` |
| Windows 包静态核验 | `node scripts/verify-package.mjs` | 通过 |

首次 Windows 打包尝试因网络代理无法下载 Electron Windows 运行时而失败；随后使用本机已有且 `unzip -t` 完整通过的 Electron 44.3.0 win32-x64 官方结构 ZIP，通过源码既有 `AIVIDEO_ELECTRON_ZIP_DIR` 离线入口完成构建，没有改造安装器。

## 本轮新增专项覆盖

- 无字幕校验：纯禁止通过；纯添加拒绝；逗号、`且`、`或` 冲突拒绝；中英文混合正向加字拒绝；任一片段冲突阻止整个任务包。
- 异步边界：revision=1 预检未返回时编辑到 revision=2；旧结果不能覆盖内存或磁盘，费用标记为未完成当前修订预检，旧确认不可提交。
- 原子编辑：无效 patch 不改变已保存草稿；提交锁期间编辑被拒绝。
- 导入清理：ZIP 结构/哈希在入库前拒绝；第2/第3素材入库失败、草稿创建失败、会话持久化失败均无可提交残留。
- 保守恢复：只有来源路径、无任务/项目/云上传引用且确认为本次新建的资产记录才回滚；归属不确定则保留实际被引用文件并写 `failed-import.json`，标记 `submittable:false`；重启发现中断导入同样只做不可提交恢复标记，不删除原文件。
- 三份文档：磁盘文件与 `packageGuide()` 正式导出逐字节一致。

## 17 秒协议回归

源码所带 `v120-valid-realmedia-17s.zip` 通过生产 `SafeTaskZip`、`validateTaskPackage` 与 `TaskPackageService.importZip` 链路；JPG/MP4/WAV 签名、ZIP CRC、素材 SHA-256、`@素材` 槽位转换、预检、编辑、重新预检、确认、非付费 Draft 准备和重复导入保护均有自动化覆盖。MediaInfo 实测参考 MP4 为 9.6 秒、25 fps、320×568；WAV 为 14 秒、16 kHz、单声道、16 bit；输出 17 秒，视频综合预算 26.6/30 秒。双段夹具证明 motion/voice 不串段。

该夹具是“真实媒体格式的合成测试素材”，不是用户此前确认的《空腹理想体重》真实业务素材；附件中没有该真实任务包，因此未验证原片 3.0–12.6 秒的真实画面内容，也不将合成素材冒充真实业务验收。

## 未完成项

- Windows 10/11 真机启动、退出、重启、托盘、DPAPI、文件选择器、真实 UI 交互与独立测试用户数据目录验收。
- 真实旧版用户数据升级保留的 Windows 真机验证。
- 《空腹理想体重》真实 17 秒业务包的画面与素材内容验收。
- Wan 云端付费生成、成片烧录字幕、口型及下载验收。

因此当前交付仍为 Candidate，不标记正式稳定版。

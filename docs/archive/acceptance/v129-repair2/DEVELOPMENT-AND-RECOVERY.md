# v1.2.9 修复版2：开发、数据结构与恢复

Node.js 24.19.0 或更高；版本固定 1.2.9。原始开发基线 e7ec1658f155a2614522004f913f35986a595b28。

## 安装和验证

```powershell
npm ci
npm run typecheck
npm test
npm run test:ui
npm run test:repair2
npm run build
npm run test:bundle
npm run test:repair2:windows
```

`npm test` 自动从 mediainfo.js 恢复 WASM。两份 V2.2 模板原件已纳入源码，SHA-256与历史受保护记录一致。不要用替代模板让测试通过。

Windows 打包还需 FFmpeg、FFprobe、sherpa-onnx 运行时。源码 ZIP 不携带可重新获取的大型二进制。可从已安装版 `resources/app/resources` 核验恢复：

```powershell
node scripts/restore-repair2-runtime.mjs "C:\现有安装目录\resources\app\resources"
npm run setup:electron
npm run pack:win
node scripts/verify-package.mjs
```

恢复程序逐文件检查 `RUNTIME-RESOURCES.json`，不接受不同哈希的文件。若没有旧安装版，需从官方 FFmpeg 和 sherpa-onnx 分发源补充相应运行时，不能把未知 EXE 放入发布包。模型权重按 `resources/sherpa-onnx/README.txt` 安装，未包含大型模型。

## 数据与恢复

旧主数据库不变；真人口播使用数据根目录下 `real-speech/real_speech.db`（SQLite user_version=2）。Windows 正常数据根仍为既有 `D:\吃个糖Agent数据库`，不要清空。

- tasks：任务 JSON，含稳定 Unit/Phrase、Window、revision、导演备注、诊断、历史音频。
- plans：已应用协议 ID、hash、task_id 和协议 JSON，拒绝重复应用。
- audio_assets：独立音频资产与来源信息。
- outputs/taskId/windowId/revN-UUID：request.json、云端 response.json（有响应时）、audio.wav。旧结果永久保留。
- exports/EXP-UUID：文字上下文和用户选择导出的音频附件。

备份时退出程序，复制完整数据根，保留数据库、WAL/SHM（若存在）和音频目录。不要只恢复数据库而丢失音频。升级前数据库自动备份见 pre-v129.db/pre-v129-repair.db；回退必须先备份当前数据，再配套恢复同一时点数据库和 outputs，不能用删除数据库修复。

unknown_result/interrupted：核对云端后优先恢复下载。恢复只发GET，不自动重新付费。修改参数、音色、原稿或切换旧版本不能消除未知请求保护；明确确认后才允许人工再次提交。

## 测试边界

Windows 流程测试窗口使用隔离临时 SQLite、真实 React DOM 事件和真实 FFmpeg，TTS采用模拟WAV。文件位置入口检查受管文件存在。该测试不是正式主进程 IPC、资源管理器交互或真人声音质量的全部验收。独立交付包启动检查尚未验证；真实云端需用户配置音色和密钥后验收。

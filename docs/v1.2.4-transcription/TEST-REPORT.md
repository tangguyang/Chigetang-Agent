# v1.2.4 转文字实装｜测试与交付说明

## 交付内容

完整源码 ZIP、Windows 10/11 x64 绿色包、模型安装说明、测试记录与真实输出样本。版本号仍为 1.2.4。

共修改 5 个业务源文件：转文字页面、转文字服务、转文字共享类型与分段、主进程相关 IPC、转文字局部样式；另外 69 个业务源文件与上传版本逐字节一致。构建资源检查和测试/说明文件按需补充，没有修改历史数据库。

## 实际测试结果

| 检查 | 结果与范围 |
|---|---|
| TypeScript typecheck | 通过。原始源码转写文件有一处类型错误，本次修复。 |
| 已有自动测试 | 95 项通过，未调用收费 API。 |
| 已有 UI DOM 测试 | 65 项通过，包含默认“一键生成”。 |
| v1.2.4 原有专项检查 | 4 项通过。 |
| 新增转写专项 | 12 项通过、0 跳过，使用真实模型与 sherpa-onnx CPU 推理。 |
| 转写页面联调 | 真实服务与真实 ASR：选择/拖入、重复点击保护、切页恢复、两份结果、复制/查看调用、移除、取消及重新开始。 |
| build / bundle | 通过；MediaInfo 从构建产物读取真实 MP4。 |
| Windows 绿色包 | 完成构建；x64 PE、版本、图标、构建文件哈希和必需资源检查通过。 |
| Windows 真机启动 | 未验证：当前主机为 Linux，不能据此宣称 Windows 真机安装启动通过。 |

### 真实识别证据

- 官方 SenseVoice 测试样本 `zh.wav`，5.592 秒中文语音；实际生成两份 UTF-8 BOM TXT。
- 模型原始输出：`开饭时间早上9点至下午5点。`。这是未经人工改写的识别结果，模型存在同音字误识别。
- MP3 实际编码后转写成功，连续任务通过。
- MP4 音轨人为延迟 1.25 秒，识别首段相对 WAV 的变化为 **1260 ms**，证实视频时间轴未被重置到人声起点。
- 44.736 秒重复中文口播通过实际停顿拆段识别，保留所有原始 token 和分段偏移；时间帧不倒序、不重叠。模型对重复内容仍可能漏字，不将“任务成功”当作“逐字准确率 100%”。
- 取消测试捕获真实 sherpa 子进程 PID，取消后确认该 PID 不再存活，再次转写成功。
- 中文/空格路径、无音轨、损坏文件、静音、模型缺失/不完整、FFmpeg 缺失、运行时缺失/无法启动均验证。
- 磁盘写入失败用 ENOSPC 故障注入验证：中文提示、无半份结果、临时数据清理；没有人为占满实际磁盘。
- 原始数据及两份样本在本目录 `samples`；其中 `internal-recognition-evidence.json` 是测试取证副本，产品的用户结果目录仍只有两份 TXT。

### 测试边界与原有脚本修正

原版 `scripts/test-ui.tsx` 在主动切换到“生成视频”后仍断言“一键生成”，原封不动的源码也在此失败。本次仅更正测试断言并增加转写进度 IPC 的测试桩，未修改首页或视频页面。原版 `tests/v124.test.ts` 对导航图标的预期与源码不符，改为验证原有 FileText 图标，并按需求更新时间码格式。

UI 联调通过 jsdom 执行真实 React 交互与真实后端服务，原生文件选择器/剪贴板/打开文件采用边界替身。不是 Windows 桌面点击测试。曾尝试在 Linux 启动 Electron 实例，但环境禁止其单实例锁所需 Unix socket，未完成真实窗口截图与完整 Electron IPC 自动化；未为此修改产品单实例行为。

## 技术选择

官方 sherpa-onnx **v1.13.8 Windows x64 static MT Release CLI**，通过独立子进程运行，避免 Electron 44 native addon ABI 和打包耦合。CPU 推理，无 Python/CUDA，不使用云端 ASR。Windows 引擎仅依赖系统 DLL。

运行时 SHA-256：`57ad48bd49d0d22207f65facf607f8aefcf0aae7240a37e5ba0415ae85f43c4d`。

模型固定为 2024-07-17 INT8。程序启动任务前流式校验两个模型文件 SHA-256；模型单独安装，升级不覆盖模型目录。Windows CLI 使用 ASCII 相对参数和 Unicode 工作目录以规避系统代码页对中文路径的影响。

## 已知限制

- CTC token 时间步约 **60 ms**，显示三位毫秒不意味着毫秒级对齐精度。模型没有返回 token duration 时，结束采用下一个真实 token 起点、检测到的静音边界或音轨结束，不均匀摊派文字时间。
- 分段目标 2–5 秒，语义/词语完整优先，可能出现更短或更长片段。
- 单文件最长 4 小时。若存在超过 2 分钟没有检测到停顿的连续音频，明确提示先分为较短文件，不静默截断。
- 识别可能出现同音字、数字、标点、语言自动判断错误；无 AI 润色/补写，正式使用前需核对原声。
- 尚无 Windows 真机验证，不交付“已在 Win10/11 实机全部通过”的虚假结论。提供的是可构建的正式绿色包，不是安装器。

## 复现

`npm ci` → `npm run typecheck` → `npm test` → `npm run test:ui` → `npm run build` → `npm run test:bundle`。

真实专项：设置 `TRANSCRIPTION_FIXTURES` 指向包含 `zh.wav`、`model.int8.onnx`、`tokens.txt` 的目录，`AIVIDEO_SHERPA_ONNX_PATH` 指向本机官方 CLI，然后运行 `npm run test:transcription` 与 `npm run test:transcription:ui`。原模型包自带 `test_wavs/zh.wav`，测试前放入该测试目录。不提供这些环境变量时，后端脚本明确标为跳过真实识别，不能作为实测通过证据。

Windows 构建：`npm run pack:win`；`node scripts/verify-package.mjs` 检查产物。

## 官方来源

- https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8
- https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html
- https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/offline-recognizer-sense-voice-impl.h

模型安装请阅读标题右侧文档图标中的完整指南。

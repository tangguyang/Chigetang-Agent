# API Key安全配置与Spike预检

## 推荐：复用现有软件安全凭据

1. 吃个糖Agent → “模型与 API” → 新建/编辑阿里云账户。
2. 填入你的北京地域API Key、Workspace ID，地域选择cn-beijing。仅保存账户，本轮不要点会发远程请求的连接测试、音色创建或生成按钮。
3. 已有CosyVoice 3.5 Plus克隆音色绑定到该账户。第一批只使用现有音色；没有现有音色时停止，另列复刻成本取得批准。
4. 本机默认数据根为 `D:\吃个糖Agent数据库`，密文位于 `database\ai-video.sqlite` 的credentials.encrypted列。CredentialManager调用Electron safeStorage加密/解密；界面仅有maskedKey，明文只在获批请求提交时短暂进入主进程内存。

代码依据：src/main/services/credentials.ts；原音色表cosy_voices。Spike只读打开既有库，复用CredentialManager读取密钥，不实例化Application、不迁移旧库、不把密钥写入任何文件。

先离线检查矩阵（不访问凭据、不访问网络）：

```powershell
npm run spike:dry-run
```

配置后只读列出可用音色（不解密Key、不访问网络）：

```powershell
npm run spike:preflight
```

选定本地voiceRef再只读核对绑定：

```powershell
npm run spike:preflight -- --voice-ref <本地音色ID>
```

若根目录不同，可加 `--data-root <既有数据根>`。错误不回退到明文文件，不自动新建收费音色。此阶段没有验证远程Key是否有效，只验证本地元数据与加密机制；最终远程认证需在用户批准的请求中确认。

## 备选：本机环境变量

只有明确选择 `--credential-source env` 才使用环境变量，不自动切换：DASHSCOPE_API_KEY、COSYVOICE_SPIKE_WORKSPACE_ID、COSYVOICE_SPIKE_VOICE_ID（真实远程克隆voice_id）、COSYVOICE_SPIKE_VOICE_REF（该现有音色的本地标识）。建议在Windows环境变量界面配置或使用当前PowerShell进程的安全输入；不要将Key粘贴到聊天、命令历史、JSON、Markdown或测试文件。环境方式的音色类型由用户确认，离线不能证明远程存在或权限。

本轮不需要本地明文私密配置文件。已有.gitignore排除.env/.env.*、credentials.json、secrets.json、*.key等；新增排除*.spike-approval.json与.spike-private/。批准文件不含API Key，它只记录测试范围与预算。

## 当前停止点

真实付费执行必须同时具备明确批准文件（approved=true、完整矩阵hash/音色/账户/Workspace/Case/请求与费用上限）和显式执行开关。同一批准启动过就禁止重复运行；未知响应不自动重试。实际执行命令在你配置并批准后再给出，本轮未执行。

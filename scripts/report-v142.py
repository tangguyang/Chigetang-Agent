from pathlib import Path
import json,re,hashlib,subprocess,shutil
root=Path.cwd();out=root/'docs/acceptance';out.mkdir(parents=True,exist_ok=True)
base=root/'acceptance/v1.4.1-video-2026-10-02';now=root/'acceptance/v1.4.2-video-2026-10-02'
old=json.loads((base/'payload-captures.json').read_text(encoding='utf-8'));new=json.loads((now/'payload-captures.json').read_text(encoding='utf-8'))
def canonical(v):
 if isinstance(v,str):return 'oss://offline-fixture/ASSET' if v.startswith('oss://offline-fixture/') else v
 if isinstance(v,list):return [canonical(x) for x in v]
 if isinstance(v,dict):return {k:canonical(x) for k,x in v.items()}
 return v
assert canonical(old)==canonical(new),'Provider payload regression'
payload={'cases':len(new),'baseline':'2b184762814cfb6b464cecebeaa74cec2f96360e','canonicalPayloadEqual':True,'ignoredOnly':'isolated imported asset UUID in fake OSS URL','inputPromptAndParametersUnchanged':True,'realPaidRequests':0}
(out/'v142-payload-regression.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
results=json.loads((now/'results.json').read_text(encoding='utf-8'));assert all(v['status']=='PASS' for v in results.values())
(out/'v142-video-offline-results.json').write_text(json.dumps({k:{'status':v['status']} for k,v in results.items()},ensure_ascii=False,indent=2),encoding='utf-8')
for name in ['token-metrics','portable-report','runtime-report']:
 shutil.copyfile(root/f'tmp/v142-{name}.json',out/f'v142-{name}.json')
metrics=json.loads((out/'v142-token-metrics.json').read_text(encoding='utf-8'))
print('tools bytes reduction',round(100*(1-metrics['leanToolsBytes']/metrics['fullToolsBytes']),2))
print('compact bytes reduction',round(100*(1-metrics['compactResponseBytes']/metrics['normalExecutionBytes']),2))
logs=['typecheck','unit','ui','ui-focused','repair2','windows','speech-v2','bundle','build','runtime','portable','npm-ci']
for name in logs:
 p=root/f'tmp/v142-{name}.log'
 if p.exists():
  text=p.read_text(encoding='utf-8',errors='replace')
  if name in ['unit','repair2','speech-v2']:assert re.search(r'fail 0',text),(name,'tests failed')
  (out/f'v142-{name}.txt').write_text(text,encoding='utf-8')
files={}
for directory in ['src/main/models','src/main/providers']:
 for p in (root/directory).rglob('*.ts'):
  rel=p.relative_to(root).as_posix();head=subprocess.check_output(['git','show','HEAD:'+rel]);current=p.read_bytes();assert head.replace(b'\r\n',b'\n')==current.replace(b'\r\n',b'\n'),rel;files[rel]=hashlib.sha256(current).hexdigest()
(out/'v142-provider-source-hashes.json').write_text(json.dumps(files,ensure_ascii=False,indent=2),encoding='utf-8')
fee='''【v1.4.2 WAN3.0真实验收费用确认】

状态：继续暂停，等待人类明确授权。本轮真实 WAN / CosyVoice 付费 API 请求数：0。
现有账号：阿里云百炼，wan3.0-video，cn-beijing；API Key 与 Workspace 已存在。未更改账号、密钥、数据根或模型。
价格于2026-10-02重新查阅官方页面：北京480P原价¥0.30/秒，输入视频+输出视频按秒计费；不预先抵扣优惠或免费额度。余额/实际生成配额仍未知。

|链路|次数/片段|官方模型|最小验收参数|单次原价估算|
|---|---|---|---|---|
|A 参考生视频|1次|wan3.0-video|3秒参考视频，480P，输出2秒，9:16，audio=false|¥1.50|
|B 一键生成|1次/1个segment|wan3.0-video|同上|¥1.50|
|C 一键复刻|1次/1个GEN|wan3.0-video|同上|¥1.50|
|D 独立任务复制|1次|wan3.0-video|复制A真实完成任务后同上|¥1.50|
|合计|4次|||¥6.00|

固定duration、不采用智能时长、不新增Prompt优化。采用3秒参考素材以满足现有本地任务包编译约束；确切裁切与各链路预检将在授权后提交前完成。若参数或费用上升，先重新报告；失败/超时不自动再次生成。
输出位置：D:\\Codex\\吃个糖Agent项目\\acceptance\\v1.4.2-video-2026-10-02\\outputs\\paid-api-acceptance
计费按实际媒体秒数结算，估计不是最终账单。计划每条链路只生成一次；必须取得真实taskId、状态变化、Completed、下载MP4、大小>0、ffprobe可读、合理时长、存在的输出路径才可PASS。
官方来源：https://help.aliyun.com/zh/model-studio/wan3-0-video
计费公式：https://help.aliyun.com/zh/model-studio/model-pricing
'''
(out/'FEE_CONFIRMATION.md').write_text(fee,encoding='utf-8')
print('Offline video stages and 7 payload cases verified; source adapters unchanged')

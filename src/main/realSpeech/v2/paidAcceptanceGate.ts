import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export class PaidAcceptanceGate {
 private chains=new Set<string>();
 private expires:number;
 private root:string; constructor(root:string){ this.root=root;
  const permit=JSON.parse(readFileSync(join(root,'paid-acceptance-permit.json'),'utf8'));
  this.expires=Date.parse(permit.expiresAt);
  if(permit.schema!=='V142_PAID_ACCEPTANCE_ONCE'||permit.budget!==6||permit.maxCalls!==4||!Number.isFinite(this.expires)||this.expires<=Date.now()||this.expires>Date.now()+3600000)throw Error('一次性真实验收授权无效');
  writeFileSync(join(root,'paid-acceptance-consumed.json'),JSON.stringify({startedAt:new Date().toISOString(),pid:process.pid}),{flag:'wx'});
 }
 reserve(task:any,body:any){
  const chain=String(task?.snapshot?.draft?.name||'').match(/^v142真实验收([ABCD])(?:$|[ ·])/u)?.[1];
  const q=body.parameters;
  const assets=task?.snapshot?.assets;
  if(Date.now()>=this.expires||!chain||this.chains.has(chain)||this.chains.size>=4||body.model!=='wan3.0-video'||body.input?.prompt!=='保持参考素材中的主体与动作。'||q.duration!==2||q.resolution!=='480P'||q.ratio!=='9:16'||q.audio!==false||q.prompt_extend!==false||q.watermark!==false||q.seed!==123||!Array.isArray(assets)||assets.length!==1||assets[0].role!=='reference_video'||(!Number.isFinite(assets[0].duration)||assets[0].duration<=0||assets[0].duration>3)||body.input?.media?.length!==1||body.input.media[0].type!=='reference_video')throw Error('超出本次四任务白名单或参数/费用上限');
  writeFileSync(join(this.root,'paid-attempt-'+chain+'.json'),JSON.stringify({chain,taskId:task.id,time:new Date().toISOString(),reservedOriginalPrice:1.5}),{flag:'wx'});
  this.chains.add(chain);
  return {chain,call:this.chains.size,limit:4};
 }
}

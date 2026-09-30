import { compilePrompt } from '../../shared/mentions.ts';
import { readFile } from 'node:fs/promises';
import type { Snapshot, Json } from '../../shared/types.ts';
import { BaseAdapter, WanAdapter, type CloudStatus } from './adapters.ts';
import { createAdapter } from './registry.ts';
import { endpoint } from '../providers/adapters.ts';
import { HttpClient, secureURL, object, str } from '../providers/http.ts';
import { AppError } from '../services/errors.ts';
import { validateInput } from './validation.ts';
import { wanPreflight, formatWanIssue } from '../../shared/safeWanPreflight.ts';
export function engineEndpoint(s:Snapshot){
 if(s.provider.adapter!=='kling')return endpoint(s);
 const u=secureURL(s.account.endpoint||s.provider.endpoint);
 if(!['api.klingai.com','api-singapore.klingai.com','api-beijing.klingai.com'].includes(u.hostname)||u.port||u.search||u.hash||u.pathname!=='/')throw new Error('可灵 Endpoint 必须为官方 HTTPS 根地址');
 return u.origin;
}
export class SafeWanAdapter extends WanAdapter {
 override validateInput=(s:Snapshot)=>{
  const issue=wanPreflight(s.model,s.draft,s.assets).issues.find(x=>x.severity==='error');
  if(issue)throw new Error(formatWanIssue(issue));
  validateInput({...s,model:{...s.model,adapter:'wan3'}});
 };
 override submitTask(s:Snapshot,key:string,assets:Json[],signal?:AbortSignal){return super.submitTask({...s,model:{...s.model,adapter:'wan3'},draft:{...s.draft,params:{prompt_extend:false,...s.draft.params}}},key,assets,signal);}
}
export class KlingAdapter extends BaseAdapter {
 override validateInput=(s:Snapshot)=>{validateInput(s);engineEndpoint(s);if(![5,10].includes(Number(s.draft.params.duration)))throw new Error('可灵时长仅支持 5 / 10 秒');};
 async uploadAssets(s:Snapshot){return Promise.all(s.assets.map(async a=>({image:(await readFile(a.managedPath||a.originalPath)).toString('base64')})));}
 private route(s:Snapshot){return s.assets.length?'image2video':'text2video';}
 async submitTask(s:Snapshot,key:string,assets:Json[],signal?:AbortSignal){
 const raw=await this.http.request(engineEndpoint(s)+'/v1/videos/'+this.route(s),key,{method:'POST',paidSubmit:true,signal,body:{model_name:s.model.officialId,prompt:compilePrompt(s.draft,s.assets,s.model.adapter),duration:String(s.draft.params.duration),mode:'pro',sound:s.draft.params.audio?'on':'off',...(assets.length?{image:str(object(assets[0]).image)}:{aspect_ratio:String(s.draft.params.ratio)})}});
 const r=object(raw); if(typeof r.code!=='number')throw new AppError('SubmissionUnknown','提交响应无法确认，请先核对官方控制台'); if(r.code!==0)throw new AppError('ValidationError',str(r.message)||'可灵拒绝请求');
 const id=str(object(r.data??{}).task_id);if(!id)throw new AppError('SubmissionUnknown','未收到云端任务 ID，请先核对官方控制台，勿重复提交');return id;
 }
 async getTaskStatus(s:Snapshot,key:string,id:string,signal?:AbortSignal):Promise<CloudStatus>{
 const raw=await this.http.request(engineEndpoint(s)+'/v1/videos/'+this.route(s)+'/'+encodeURIComponent(id),key,{signal});const r=object(raw);if(r.code!==0)throw new Error(str(r.message)||'可灵查询失败');const d=object(r.data);
 const statuses:Record<string,CloudStatus['status']>={submitted:'pending',processing:'processing',succeed:'succeeded',failed:'failed'};
 const videos=object(d.task_result??{}).videos;const first=Array.isArray(videos)?videos[0]:null;
 return {status:statuses[str(d.task_status)]||'unknown',raw,url:first?str(object(first).url):undefined,message:str(d.task_status_msg)};
 }
}
export function createEngineAdapter(model:Snapshot['model'],http:HttpClient,download:(url:string,path:string)=>Promise<string>){return model.adapter==='kling'?new KlingAdapter(http,download):model.adapter==='wan-safe'?new SafeWanAdapter(http,download):createAdapter(model,http,download);}

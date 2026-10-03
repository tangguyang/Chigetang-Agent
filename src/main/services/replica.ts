import { createHash, randomUUID } from 'node:crypto';
import { brand } from '../../shared/brand.ts';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Application } from './application.ts';
import { SafeTaskZip } from './taskPackage.ts';
import { validPackagePath } from '../../shared/taskPackage.ts';
import type { ReplicaSession } from '../../shared/replica.ts';
import type { AssetRole, Snapshot, Params, Draft } from '../../shared/types.ts';
import { defaults } from '../../shared/catalog.ts';
import { autoBindMentions } from '../../shared/mentions.ts';
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const roles:AssetRole[]=['reference_image','reference_video','reference_audio','first_frame','last_frame'];
export class ReplicaService {
 busy=new Set<string>();
 private app:Application;
 constructor(app:Application){this.app=app;}
 list(){return this.app.db.get<ReplicaSession[]>('replica:sessions',[]);}
 get(id:string){const s=this.list().find(x=>x.id===id);if(!s)throw new Error('复刻任务不存在');return s;}
 save(s:ReplicaSession){const list=this.list();this.app.db.set('replica:sessions',[s,...list.filter(x=>x.id!==s.id)]);return s;}
 async importZip(path:string){const data=await readFile(path);return this.exclusive(hash(data),()=>this.importBytes(data));}
 private async importBytes(data:Buffer){
 const id=hash(data);const previous=this.list().find(s=>s.id===id);if(previous)return previous;
 const zip=new SafeTaskZip(data);const m=JSON.parse(zip.read('manifest.json').toString());
 if(m.schema!=='chigetang.replica'||m.version!=='1.0'||typeof m.name!=='string'||!Array.isArray(m.assets)||!Array.isArray(m.segments)||!m.segments.length||m.segments.length>100)throw new Error('需要 chigetang.replica 1.0 任务包；旧任务包请使用一键生成');
 if(Object.keys(m).some(k=>!['schema','version','name','assets','segments'].includes(k)))throw new Error('任务包含未知字段');
 const exact=(o:unknown,keys:string[])=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
 for(const a of m.assets)if(!exact(a,['id','path','type','sha256']))throw new Error('素材包含未知字段');
 for(const s of m.segments){if(!exact(s,['id','model_id','prompt','params','bindings']))throw new Error('GEN 包含未知字段');if(!s.params||Array.isArray(s.params)||typeof s.params!=='object'||Object.values(s.params).some(v=>!['string','number','boolean'].includes(typeof v)))throw new Error('GEN 参数无效');if(!Array.isArray(s.bindings)||s.bindings.some((b:unknown)=>!exact(b,['asset_id','role'])))throw new Error('素材绑定字段无效');}
 const ids=new Set<string>(),paths=new Set<string>();
 for(const a of m.assets){if(typeof a.id!=='string'||ids.has(a.id)||typeof a.path!=='string'||!validPackagePath(a.path)||!a.path.startsWith('assets/')||paths.has(a.path)||!['image','video','audio'].includes(a.type)||!/^[a-f0-9]{64}$/.test(a.sha256)||hash(zip.read(a.path))!==a.sha256)throw new Error('素材声明、路径或 SHA256 校验失败');ids.add(a.id);paths.add(a.path);}
 const segmentIds=new Set<string>();
 for(const s of m.segments){if(!/^G\d{3}$/.test(s.id)||segmentIds.has(s.id)||typeof s.prompt!=='string'||!Array.isArray(s.bindings)||!s.params||typeof s.params!=='object')throw new Error('GEN 定义无效');segmentIds.add(s.id);if(!this.app.models().some(x=>x.id===s.model_id&&x.enabled&&x.type==='video'&&x.adapter!=='wan3'))throw new Error('请选择新工作台支持的模型');for(const b of s.bindings)if(!ids.has(b.asset_id)||!roles.includes(b.role))throw new Error('素材绑定不存在或角色错误');}
 const folder=join(this.app.root,'cache','replica',id);await mkdir(folder,{recursive:true});const assets=new Map<string,string>();
 for(const a of m.assets){const output=join(folder,a.path);await mkdir(join(output,'..'),{recursive:true});await writeFile(output,zip.read(a.path));const imported=await this.app.assets.import(output,false);if(imported.asset.kind!==a.type)throw new Error('素材实际类型与声明不一致');assets.set(a.id,imported.asset.id);}
 return this.save({id,name:m.name,revision:1,confirmed:false,state:'ready',taskIds:[],segments:m.segments.map((s:any)=>({id:s.id,draft:{draftId:randomUUID(),name:m.name+' '+s.id,modelId:s.model_id,accountId:'auto',projectId:null,prompt:s.prompt,params:{...defaults(this.app.models().find(x=>x.id===s.model_id)!),...s.params},assets:s.bindings.map((b:any)=>({assetId:assets.get(b.asset_id)!,role:b.role})),outputDir:this.app.settings().outputDir}}))});
 }
 update(id:string,segmentId:string,draft:Draft){if(this.busy.has(id))throw new Error('处理中');const s=this.get(id);if(s.state!=='ready')throw new Error('已提交轮次不可修改');const segment=s.segments.find(x=>x.id===segmentId);if(!segment)throw new Error('GEN 不存在');const model=this.app.models().find(m=>m.id===draft.modelId&&m.enabled&&m.adapter!=='wan3');if(!model)throw new Error('模型不可用');segment.draft={...segment.draft,modelId:draft.modelId,accountId:draft.accountId,prompt:draft.prompt,params:draft.params,assets:draft.assets,outputDir:draft.outputDir};s.revision++;s.confirmed=false;s.fingerprint=undefined;for(const x of s.segments){delete x.cost;delete x.issue;}return this.save(s);}
 private async exclusive<T>(id:string,fn:()=>Promise<T>){if(this.busy.has(id))throw new Error('处理中');this.busy.add(id);try{return await fn();}finally{this.busy.delete(id);}}
 preflight(id:string){return this.exclusive(id,()=>this.preflightOnce(id));}
 private async preflightOnce(id:string){const s=this.get(id);if(s.state!=='ready')throw new Error('已提交或锁定的任务不可预检');s.confirmed=false;delete s.fingerprint;this.save(s);
 for(const segment of s.segments){try{const d=segment.draft;const model=this.app.models().find(m=>m.id===d.modelId&&m.enabled)!;if(!model)throw new Error('模型不可用');
 const accounts=this.app.credentials.list().filter(a=>a.providerId===model.providerId&&a.enabled);
 const account=d.accountId==='auto'?(accounts.find(a=>a.isDefault)||(accounts.length===1?accounts[0]:undefined)):accounts.find(a=>a.id===d.accountId);
 if(accounts.length>1&&!account)throw new Error('请选择明确的 API 账户');
 const assets=await Promise.all(d.assets.map(async b=>{const a=await this.app.assets.refreshMetadata(b.assetId);await this.app.assets.verify(a);return {...a,role:b.role};}));
 const draft=autoBindMentions(d,assets);const snapshot:Snapshot={draft,model,provider:this.app.providers().find(p=>p.id===model.providerId)!,account:account??{id:'offline',providerId:model.providerId,name:'离线预检',endpoint:'',workspaceId:'offline',region:'cn-beijing',notes:'',manualBalance:'',enabled:true,isDefault:false,maxConcurrent:1,createdAt:'',maskedKey:''},assets,price:model.price,estimatedCost:{amount:null,currency:model.price.currency,kind:'unknown',note:''},appVersion:brand.version,createdAt:''};
 this.app.tasks.d.adapter(model).validateInput(snapshot);segment.cost=this.app.tasks.estimate(d).cost;delete segment.issue;
 }catch(e){segment.issue=String(e);delete segment.cost;}}
 try{s.fingerprint=await this.fingerprint(s);}catch{delete s.fingerprint;}return this.save(s);}
 private async fingerprint(s:ReplicaSession){const assets=[];for(const x of s.segments)for(const b of x.draft.assets){const a=this.app.assets.get(b.assetId);assets.push([a.id,hash(await readFile(await this.app.assets.verify(a)))]);}return hash(JSON.stringify([s.revision,s.segments.map(x=>x.draft),this.app.models(),this.app.providers(),this.app.credentials.list(),assets]));}
 confirm(id:string,revision:number){return this.exclusive(id,()=>this.confirmOnce(id,revision));}
 private async confirmOnce(id:string,revision:number){const s=this.get(id);if(s.state!=='ready'||s.revision!==revision||!s.fingerprint||s.segments.some(x=>x.issue)||await this.fingerprint(s)!==s.fingerprint)throw new Error('配置已变化，请重新预检');s.confirmed=true;return this.save(s);}
 async submit(id:string){if(this.busy.has(id))throw new Error('正在提交');this.busy.add(id);try{const s=this.get(id);if(s.state==='submitted')return s;if(s.state!=='ready'||!s.confirmed||await this.fingerprint(s)!==s.fingerprint)throw new Error('请重新预检并确认');for(const x of s.segments){const model=this.app.models().find(m=>m.id===x.draft.modelId)!;const accounts=this.app.credentials.list().filter(a=>a.enabled&&a.providerId===model.providerId);const account=x.draft.accountId==='auto'?(accounts.find(a=>a.isDefault)||(accounts.length===1?accounts[0]:undefined)):accounts.find(a=>a.id===x.draft.accountId);if(!account)throw new Error(x.id+'：请先配置并选择 API 账户');this.app.credentials.getKey(account.id);}
 s.state='blocked';this.save(s);
 for(const x of s.segments){const t=await this.app.tasks.create(x.draft,`replica:${id.slice(0,40)}:${x.id}`,undefined,true);s.taskIds.push(t.id);this.save(s);}
 s.state='submitted';this.save(s);for(const taskId of s.taskIds)this.app.tasks.resume(taskId);return s;
 }finally{this.busy.delete(id);}}
}

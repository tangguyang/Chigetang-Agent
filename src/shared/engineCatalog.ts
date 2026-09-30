import { models, providers } from './catalog.ts';
import type { Model, Provider } from './types.ts';
export const engineProviders: Provider[] = [...providers, { id:'kling', name:'可灵', adapter:'kling', endpoint:'https://api-singapore.klingai.com', region:'global', enabled:true, maxConcurrent:2, docs:'https://kling.ai/document-api/quickStart/userManual' }];
export const engineModels: Model[] = [...models, { ...structuredClone(models[0]), id:'wan-safe', capabilities:{...structuredClone(models[0].capabilities),parameters:models[0].capabilities.parameters.map(p=>p.key==='duration'?{...p,options:['-1',...Array.from({length:29},(_,i)=>String(i+2))]}:p)}, adapter:'wan-safe', name:'Wan 3.0 · 完整音频', verified:false, note:'保留完整参考音频；超出能力时阻止提交，不自动截短。' }, {
 ...structuredClone(models[1]), id:'kling26', providerId:'kling', adapter:'kling', officialId:'kling-v2-6', name:'可灵 2.6', verified:false,
 note:'文生视频 / 单首帧图生视频；官方 API Key；真实云端生成待账户验证。',
 capabilities:{...structuredClone(models[1].capabilities), promptLimit:2500, supportsEndFrame:false, supportsFirstLastFrame:false, supportsSeed:false, roles:['first_frame'], parameters:[
 {key:'duration',label:'时长',type:'select',options:['5','10'],default:5},
 {key:'ratio',label:'比例',type:'select',options:['16:9','9:16','1:1'],default:'9:16'},
 {key:'resolution',label:'分辨率',type:'select',options:['1080P'],default:'1080P'},
 {key:'audio',label:'声音',type:'boolean',default:false}],
 limits:{image:{extensions:['png','jpg','jpeg'],maxMB:10,maxCount:1,minSide:300,maxRatio:2.5}}},
 price:{currency:'USD',unit:'second',rate:null,source:'按当前官方账户账单配置',updatedAt:'2026-09-29'}
}];

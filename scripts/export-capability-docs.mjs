import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const list=JSON.parse(readFileSync('tmp/v142-capabilities.json','utf8'));
mkdirSync('docs/current/capabilities',{recursive:true});
writeFileSync('docs/current/capabilities/catalog.json',JSON.stringify(list,null,2)+'\n');
writeFileSync('docs/current/capabilities/API.md','# Capability API 能力清单\n\n以运行时 capability.describe 返回的Schema为准。默认compact；完整控制结果保存在resultPath。生成输入保持完整。\n\n| 能力 | 必填参数 | 作用 | 业务入口 |\n|---|---|---|---|\n'+list.map(e=>'| '+e.id+' | '+(e.inputSchema.required?.join(', ')||'无')+' | '+e.effect+' | '+e.service+' |').join('\n')+'\n');

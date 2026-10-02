import {readFileSync,writeFileSync} from 'node:fs';
const list=JSON.parse(readFileSync('tmp/v140-capabilities.json','utf8'));
writeFileSync('docs/capabilities-v140/catalog.json',JSON.stringify(list,null,2)+'\n');
writeFileSync('docs/capabilities-v140/API.md','# Capability API 能力清单\n\n以运行时 capability list 返回的Schema为准。统一输出为CHIGETANG_CAPABILITY_RESULT_V1。\n\n| 能力 | 必填参数 | 作用 | 业务入口 |\n|---|---|---|---|\n'+list.map(e=>'| '+e.id+' | '+(e.inputSchema.required?.join(', ')||'无')+' | '+e.effect+' | '+e.service+' |').join('\n')+'\n');

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {acquireWriter,completeWriterRecovery} from '../src/main/realSpeech/v2/writerLease.ts';
import {SecretFilter} from '../src/cli/output.ts';
import {CapabilityRegistry} from '../src/main/capabilities/registry.ts';
import {registerApplicationCapabilities} from '../src/main/capabilities/catalog.ts';
test('v141 stale writer recovery preserves database and WAL before reclaim; live writer stays exclusive',()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-writer-v141-'));mkdirSync(join(root,'config'));mkdirSync(join(root,'database'));
 writeFileSync(join(root,'database/ai-video.sqlite'),'db');writeFileSync(join(root,'database/ai-video.sqlite-wal'),'wal');
 writeFileSync(join(root,'config/agent-control-writer.lock'),JSON.stringify({pid:2147483647,token:'dead-owner'}));
 const release=acquireWriter(root);assert.ok(release.recovered);assert.equal(readFileSync(join(release.recovered!,'database/ai-video.sqlite'),'utf8'),'db');assert.equal(readFileSync(join(release.recovered!,'database/ai-video.sqlite-wal'),'utf8'),'wal');assert.throws(()=>acquireWriter(root),/已有写入者/);release();assert.equal(existsSync(join(root,'config/agent-control-writer.lock')),false);
 const again=acquireWriter(root);assert.equal(again.recovered,release.recovered);completeWriterRecovery(root,again.recovered!);again();const clean=acquireWriter(root);assert.equal(clean.recovered,null);clean();
});
test('v141 corrupt writer records stay blocked and untouched',()=>{const root=mkdtempSync(join(tmpdir(),'ctg-writer-invalid-'));mkdirSync(join(root,'config'));const file=join(root,'config/agent-control-writer.lock');writeFileSync(file,'bad');assert.throws(()=>acquireWriter(root),/损坏/);assert.equal(readFileSync(file,'utf8'),'bad');});
test('v141 ordinary parameter keys survive but credentials stay filtered',()=>{const result=new SecretFilter().clean({key:'secret-value',parameters:[{key:'duration',label:'时长',type:'number',default:5,apiKey:'hidden'}],nested:{key:'hidden'}});assert.equal(result.parameters[0].key,'duration');assert.equal(result.key,undefined);assert.equal(result.parameters[0].apiKey,undefined);assert.equal(result.nested.key,undefined)});
test('v141 resume is gated and prepare field reaches existing dispatcher',async()=>{const registry=new CapabilityRegistry();let calls=0;registerApplicationCapabilities(registry,async(id,p)=>{calls++;return {id,...p}});assert.equal((await registry.executeCapability({capability:'tasks.resume',params:{id:'a'}})).status,'failed');assert.equal(calls,0);const prepared=await registry.executeCapability({capability:'tasks.create',params:{draft:{},requestId:'prepare',deferQueue:true},confirm:true});assert.equal(prepared.status,'succeeded');assert.equal((prepared.result as any).deferQueue,true);});

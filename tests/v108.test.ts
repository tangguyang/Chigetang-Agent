import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/main/services/application.ts";
import { voiceCompatible } from "../src/shared/audioCatalog.ts";
import type { AudioRequest, Params } from "../src/shared/types.ts";
const vault = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
const probe = async () => ({ duration: 5, sampleRate: 24000, channels: 1, bitDepth: 16 });
function setup(fetcher: typeof fetch = async () => { throw Error("Unexpected network"); }, root = mkdtempSync(join(tmpdir(), "agent108-"))) {
 const app = new Application(root, vault, probe, () => {}, () => {}, fetcher);
 app.audio.stopped = true;
 const account = app.credentials.save({ name: "Mock Beijing", providerId: "alibaba", region: "cn-beijing", workspaceId: "ws-test", key: "mock-key", enabled: true, maxConcurrent: 2 });
 return {app,account,root};
}
function saveVoice(app: Application, accountId: string, model = "cosyvoice-v3.5-plus") {
 return app.audio.saveVoice({id: "v-" + model, name: "V1", providerId: "alibaba", region: "cn-beijing", model, accountId, voiceId: "remote-" + model, kind: "clone", createdAt: new Date().toISOString(), referenceAssetId: "", referencePath: "", notes: "", favorite: false});
}
function request(accountId: string, voiceId: string, modelId = "cosyvoice-v3.5-plus"): AudioRequest {
 return {name: "对比测试", text: "今天开始测试。", instruction: "自然清晰", accountId, modelId, voiceId, format: "wav", params: {}};
}
for (const tier of ["plus", "flash"]) test(`v108: ${tier} enrollment, exact model/API/voice binding, fixed seed generation and history`, async () => {
 const calls: { url: string; body: any; headers: Headers }[] = [];
 const wav = readFileSync(resolve("tests/fixtures/sample.wav"));
 let serial = 0;
 const fetcher: typeof fetch = async (url, init) => {
  if (String(url).includes("getPolicy")) return Response.json({data:{upload_host:"https://fixture.oss-cn-beijing.aliyuncs.com",max_file_size_mb:100,upload_dir:"fixture",oss_access_key_id:"mock",policy:"mock",signature:"mock",x_oss_object_acl:"private",x_oss_forbid_overwrite:"true"}});
  if (init?.body instanceof FormData) return new Response("",{status:200});
  if (String(url).includes("result.wav")) return new Response(wav);
  const body = JSON.parse(String(init?.body));
  calls.push({url:String(url),body,headers:new Headers(init?.headers)});
  if (body.input.action) return Response.json({output:{voice_id:`remote-${tier}-${++serial}`}});
  return Response.json({request_id:"mock-request",output:{audio:{url:"https://example.com/result.wav"}}});
 };
 const {app,account,root} = setup(fetcher);
 const source = join(root,"reference.wav"); writeFileSync(source,wav);
 const asset = (await app.assets.import(source,false)).asset;
 const modelId = `cosyvoice-v3.5-${tier}`;
 const voice = await app.audio.clone({modelId,accountId:account.id,assetId:asset.id,name:"V1"});
 const v2 = await app.audio.clone({modelId,accountId:account.id,assetId:asset.id,name:"V2"});
 assert.notEqual(voice.voiceId,v2.voiceId); assert.equal(app.audio.voices().length,2);
 assert.equal(voice.model,modelId); assert.equal(voice.accountId,account.id);
 assert.equal(calls[0].body.model,"voice-enrollment");
 assert.equal(calls[0].body.input.action,"create_voice");
 assert.equal(calls[0].body.input.target_model,modelId);
 assert.match(calls[0].body.input.prefix,/^[a-z0-9]{1,10}$/i);
 assert.match(calls[0].body.input.url,/^oss:/);
 assert.equal(calls[0].headers.get("X-DashScope-OssResourceResolve"),"enable");
 const input = request(account.id,voice.id,modelId);
 input.params = {rate:1.2,pitch:0.9,volume:70};
 const task = await app.audio.create(input,"first");
 assert.equal(JSON.parse(String(task.snapshot.draft.params.audioRequest)).params.seed,12345);
 app.audio.stopped = false; await app.audio.execute(task); app.audio.stopped = true;
 assert.equal(app.tasks.get(task.id).status,"Completed");
 assert.deepEqual(calls[2].body,{model:modelId,input:{text:input.text,voice:voice.voiceId,format:"wav",sample_rate:24000,instruction:input.instruction,seed:12345,rate:1.2,pitch:0.9,volume:70}});
 assert.match(calls[2].url,/ws-test\.cn-beijing\.maas\.aliyuncs\.com\/api\/v1\/services\/audio\/tts\/SpeechSynthesizer$/);
 assert.equal(calls[2].headers.get("Authorization"),"Bearer mock-key");
 assert.equal((await app.audio.create(input,"first")).id,task.id);
 const second = await app.audio.create(input,"second");
 app.audio.stopped = false; await app.audio.execute(second); app.audio.stopped = true;
 assert.deepEqual(calls[3].body,calls[2].body);
 assert.equal(app.audio.voices().length,2);
 const custom = await app.audio.create({...input,params:{seed:0}},"zero-seed");
 assert.equal(JSON.parse(String(custom.snapshot.draft.params.audioRequest)).params.seed,0);
 app.close();
 const next = new Application(root,vault,probe,()=>{},()=>{},fetcher);
 assert.equal(next.audio.voices().length,2);
 assert.equal(JSON.parse(String(next.tasks.get(task.id).snapshot.draft.params.audioRequest)).params.seed,12345);
 assert.deepEqual(readFileSync(source),wav);
 next.close();
});
test("v108: reject cross-model, cross-account, region and unsupported/invalid parameters before network", async () => {
 const {app,account} = setup(); const voice = saveVoice(app,account.id);
 const model = app.models().find(m=>m.id===voice.model)!;
 const input = request(account.id,voice.id);
 await assert.rejects(app.audio.create({...input,modelId:"cosyvoice-v3.5-flash"},"cross"),/不匹配/);
 assert.equal(voiceCompatible({...voice,modelMappings:{"cosyvoice-v3.5-flash":voice.voiceId}},app.models().find(m=>m.id==="cosyvoice-v3.5-flash")!,account),false);
 assert.equal(voiceCompatible(voice,model,{...account,id:"other"}),false);
 assert.equal(voiceCompatible(voice,model,{...account,region:"ap-southeast-1"}),false);
 const other = app.credentials.save({name:"other",providerId:"alibaba",region:"cn-beijing",workspaceId:"ws-other",key:"mock-other",enabled:true});
 await assert.rejects(app.audio.create({...input,accountId:other.id},"other"),/不匹配/);
 for(const seed of [-1,65536,1.5,NaN,"12345"]) await assert.rejects(app.audio.create({...input,params:{seed}},"seed"+seed),/参数 seed/);
 for(const params of ([{rate:0.4},{pitch:2.1},{volume:101},{volume:1.2},{timestamp:true}] as Params[])) await assert.rejects(app.audio.create({...input,params},JSON.stringify(params)),/参数/);
 await assert.rejects(app.audio.create({...input,instruction:"字".repeat(51)},"long"),/100 字符/);
 await assert.rejects(app.audio.create({...input,modelId:"qwen-tts-instruct",voiceId:"Cherry",params:{seed:12345}},"old-seed"),/不支持参数 seed/);
 assert.equal(app.models().find(m=>m.id==="qwen-tts-clone")!.audio!.supportsSeed,false);
 assert.equal(model.audio!.endpoints["ap-southeast-1"],undefined);
 app.close();
});
test("v108: existing data is backed up before model additions; restart is idempotent", async () => {
 const {app,account,root} = setup(); const voice = saveVoice(app,account.id,"qwen3-tts-vc-2026-01-22");
 app.db.set("audioDraft",{text:"旧草稿"});
 app.db.run("DELETE FROM pricing_configs WHERE model_id LIKE 'cosyvoice-%'"); app.db.run("DELETE FROM models WHERE id LIKE 'cosyvoice-%'");
 app.db.run("DELETE FROM settings WHERE key='v108-audio-models'");
 const before = app.db.all("SELECT * FROM voices"); const credentials = app.db.all("SELECT * FROM credentials");
 app.close();
 const next = new Application(root,vault,probe,()=>{},()=>{});
 const backups = readdirSync(join(root,"backups")).filter(n=>n.startsWith("pre-v108-")); assert.equal(backups.length,1);
 const db = new DatabaseSync(join(root,"backups",backups[0]),{readOnly:true});
 assert.equal(db.prepare("SELECT count(*) AS n FROM models WHERE id LIKE 'cosyvoice-%'").get()!.n,0);
 assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check,"ok"); db.close();
 assert.deepEqual(next.db.all("SELECT * FROM voices"),before);
 assert.deepEqual(next.db.all("SELECT * FROM credentials"),credentials);
 assert.equal(next.audio.voices()[0].voiceId,voice.voiceId);
 assert.equal(next.models().filter(m=>m.id.startsWith("cosyvoice-")).length,2);
 next.close();
 const again = new Application(root,vault,probe,()=>{},()=>{}); again.close();
 assert.equal(readdirSync(join(root,"backups")).filter(n=>n.startsWith("pre-v108-")).length,1);
});
test("v108: backup failure blocks upgrade without changing old records", async () => {
 const {app,root} = setup(); app.db.run("DELETE FROM pricing_configs WHERE model_id LIKE 'cosyvoice-%'"); app.db.run("DELETE FROM models WHERE id LIKE 'cosyvoice-%'"); app.db.run("DELETE FROM settings WHERE key='v108-audio-models'"); app.close();
 // A regular file at the backup directory deterministically simulates an unwritable destination.
 if (!existsSync(join(root,"backups"))) writeFileSync(join(root,"backups"),"blocked");
 else { const fs = await import("node:fs"); fs.rmdirSync(join(root,"backups")); writeFileSync(join(root,"backups"),"blocked"); }
 assert.throws(()=>new Application(root,vault,probe,()=>{},()=>{}),/升级前备份失败/);
 const db = new DatabaseSync(join(root,"database","ai-video.sqlite"));
 assert.equal(db.prepare("SELECT count(*) AS n FROM models WHERE id LIKE 'cosyvoice-%'").get()!.n,0);
 assert.equal(db.prepare("SELECT count(*) AS n FROM credentials").get()!.n,1); db.close();
});

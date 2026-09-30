import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {TASK_PACKAGE_VERSION,TASK_PACKAGE_PREVIOUS_VERSION,validateTaskPackage,validateNoOverlayInstructions} from '../src/shared/taskPackage.ts';
import {SafeTaskZip} from '../src/main/services/taskPackage.ts';
import {Stage1TemplateService,convertDocx,validateStageOne} from '../src/main/services/stage1Template.ts';
import {packageGuide} from '../src/shared/taskPackageDocs.ts';
function crc32(buffer:Buffer){let crc=0xffffffff;for(const b of buffer){crc^=b;for(let k=0;k<8;k++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}return(crc^0xffffffff)>>>0;}
function zip(files:Record<string,Buffer|string>){const locals:Buffer[]=[],centrals:Buffer[]=[];let offset=0,count=0;for(const [name,data] of Object.entries(files)){
 const bytes=Buffer.isBuffer(data)?data:Buffer.from(data),label=Buffer.from(name),crc=crc32(bytes),local=Buffer.alloc(30),central=Buffer.alloc(46);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(label.length,26);
 central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(label.length,28);central.writeUInt32LE(offset,42);
 locals.push(local,label,bytes);centrals.push(central,label);offset+=local.length+label.length+bytes.length;count++;
 }const idx=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(idx.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,idx,end]);}
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(version=TASK_PACKAGE_VERSION, legacyAt=false){const img=Buffer.from('image');const prompt='按 @person 复刻动作。禁止字幕与屏幕文字。';
const m={schema_version:version,package_type:'chigetang.wan-task',task_id:'test-v120-followup',task_name:'正例',engine:'wan3',assets:[{id:'person.main',type:'image',path:'assets/person.jpg',usage:'wan_reference',sha256:hash(img)}],shared:{params:{duration:17,ratio:'9:16',resolution:'720P',audio:false},bindings:{person:'person.main'}},segments:[{id:'seg01',order:1,prompt_file:'prompts/001.txt',duration_seconds:17}]};
if(legacyAt){m.shared.bindings={'@person':'person.main'} as typeof m.shared.bindings;}
const files={'manifest.json':JSON.stringify(m),'assets/person.jpg':img,'prompts/001.txt':prompt};const z=new SafeTaskZip(zip(files));return validateTaskPackage(JSON.parse(z.read('manifest.json').toString()),p=>z.has(p),p=>z.read(p).toString());}
test('protocol 1.2.0 and previous 1.1 are separate and accepted',()=>{assert.equal(fixture().schema_version,'1.2.0');assert.equal(fixture(TASK_PACKAGE_PREVIOUS_VERSION).schema_version,'1.1');assert.equal(fixture('1.0').schema_version,'1.0');assert.equal(fixture('1.0',true).schema_version,'1.0');assert.throws(()=>fixture('0.0'),/不支持的协议版本/);});
test('stage documents are separated and consistently reference current protocol',()=>{const first=packageGuide('stage1'),second=packageGuide('stage2'),spec=packageGuide('spec');for(const content of [first,second,spec])assert(content.includes('v1.2.0'));assert(!first.includes('## 12. 确定软件协议'));assert(second.includes('## 12. 确定软件协议'));assert(second.includes('v1.2.0'));assert(spec.includes('schema_version: "1.2.0"'));});
test('custom MD template preview, legacy consent, persistence, backup and restore',async()=>{const root=mkdtempSync(join(tmpdir(),'stage1-'));try{
 const svc=new Stage1TemplateService(root),old=svc.current();const template=old.content.replace('第一阶段复刻指令 v1.2.0','第一阶段复刻指令 v1.1.3')+'\n用户增加的特殊确认规则。\n';
 const file=join(root,'replacement.md');writeFileSync(file,template);const preview=await svc.inspect(file);assert.equal(preview.version,'1.1.3');assert.equal(preview.requiresLegacyConfirmation,true);assert.equal(svc.current().custom,false);
 await assert.rejects(svc.apply(preview.token,false),/不一致/);assert.equal(svc.current().custom,false);
 const saved=await svc.apply(preview.token,true);assert.equal(saved.custom,true);assert(saved.content.includes('用户增加的特殊确认规则'));
 const reopened=new Stage1TemplateService(root);assert(reopened.current().content.includes('用户增加的特殊确认规则'));
 await reopened.restore();assert.equal(reopened.current().content,old.content);assert(!reopened.current().content.includes('用户增加的特殊确认规则'));assert.equal(reopened.current().previousAvailable,true);
 }finally{rmSync(root,{recursive:true,force:true});}});
test('DOCX extraction retains paragraphs and table cell contents and validates chapters',async()=>{const root=mkdtempSync(join(tmpdir(),'stage-docx-'));try{
 const original=packageGuide('stage1');
 const lines=original.split('\n').map(line=>`<w:p><w:r><w:t xml:space="preserve">${line.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</w:t></w:r></w:p>`).join('');
 const xml=`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines}<w:tbl><w:tr><w:tc><w:p><w:r><w:t>时间</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>确认</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
 const bytes=zip({'[Content_Types].xml':'<Types/>','word/document.xml':xml});const content=convertDocx(bytes);
 assert(content.includes('时间'));assert(content.includes('确认'));assert(content.includes(' | '));validateStageOne(content);
 const file=join(root,'test.docx');writeFileSync(file,bytes);const svc=new Stage1TemplateService(root);const preview=await svc.inspect(file);assert.equal(preview.version,'1.2.0');await svc.apply(preview.token,false);assert(svc.current().content.includes(' | '));
 }finally{rmSync(root,{recursive:true,force:true});}});

test('positive overlay directives are rejected but negative constraints remain valid',()=>{assert.throws(()=>validateNoOverlayInstructions('请添加字幕。'),/附加字幕/);assert.doesNotThrow(()=>validateNoOverlayInstructions('禁止添加字幕，屏幕不出现文字。'));});

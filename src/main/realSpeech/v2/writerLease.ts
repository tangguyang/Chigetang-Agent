import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, copyFileSync, renameSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
/** Global V2 writer lease, acquired before a GUI or standalone CLI opens DB. */
export function acquireWriter(root: string) {
  mkdirSync(join(root, "config"), { recursive: true });
  const path = join(root, "config", "agent-control-writer.lock"),
    token = randomUUID();
  const pending=join(root,'config','writer-recovery-pending.json');
  let recovered: string | null = null;
  if(existsSync(pending)) {
    try {const record=JSON.parse(readFileSync(pending,'utf8'));recovered=resolve(record.backup);if(!recovered.startsWith(resolve(root,'config','writer-recovery')+sep))throw Error();}
    catch {throw Error('写入者恢复待核记录损坏；未打开数据库，请检查 '+pending);}
  }
  if (existsSync(path)) {
    let owner: {pid:number;token:string};
    const raw=readFileSync(path,'utf8');
    try { owner=JSON.parse(raw); if(!Number.isSafeInteger(owner.pid)||owner.pid<=0||typeof owner.token!=='string')throw Error(); }
    catch {throw Error('写入锁记录损坏，未打开数据库；请保留 config/agent-control-writer.lock 并检查备份。');}
    try {process.kill(owner.pid,0);throw Error(`已有写入者：主进程 PID ${owner.pid} 持有写入锁；请使用该进程的 Agent Control。不会启动第二个 writer。`);}
    catch(e) {if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
    const guard=path+'.recovery';
    try {writeFileSync(guard,JSON.stringify({pid:process.pid,token}),{flag:'wx'});}
    catch {throw Error('已有恢复操作或残留恢复保护锁；未打开数据库，请检查 '+guard);}
    try {
      if(readFileSync(path,'utf8')!==raw)throw Error('写入锁已变化，停止恢复。');
      // Preserve database + WAL bytes before reclaiming a confirmed dead owner.
      recovered=join(root,'config','writer-recovery',Date.now()+'-'+token);
      mkdirSync(recovered,{recursive:true});
      for(const relative of ['database/ai-video.sqlite','real-speech-v2/real_speech_v2.db','real-speech/real_speech.db']) {
        for(const suffix of ['','-wal','-shm']) {const from=join(root,relative+suffix);if(existsSync(from)){const to=join(recovered,relative+suffix);mkdirSync(join(to,'..'),{recursive:true});copyFileSync(from,to,1);}}
      }
      writeFileSync(join(recovered,'recovery.json'),JSON.stringify({previousOwner:owner,recoveredAt:new Date().toISOString(),queuePaused:true}));
      // Survive a second crash before Application persists queuePaused.
      writeFileSync(pending,JSON.stringify({backup:recovered,queuePaused:true}));
      renameSync(path,join(recovered,'agent-control-writer.lock'));
      writeFileSync(path,JSON.stringify({pid:process.pid,token}),{flag:'wx'});
    } finally {unlinkSync(guard);}
  } else try {
    writeFileSync(path, JSON.stringify({ pid: process.pid, token }), {
      flag: "wx",
    });
  } catch {
    throw Error("无法取得单 writer 写入锁；可能已有进程抢先启动或目录不可写。数据库未打开。锁路径："+path);
  }
  return Object.assign(() => {
    if(!existsSync(path))return;
    if (JSON.parse(readFileSync(path, "utf8")).token === token)
      unlinkSync(path);
  },{recovered});
}
export function completeWriterRecovery(root:string,backup:string) {
  const path=join(root,'config','writer-recovery-pending.json');
  if(existsSync(path)&&JSON.parse(readFileSync(path,'utf8')).backup===backup)unlinkSync(path);
}

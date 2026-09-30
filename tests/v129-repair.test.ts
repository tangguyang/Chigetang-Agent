import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RealSpeechService } from "../src/main/realSpeech/service.ts";
import { Application } from "../src/main/services/application.ts";
import { libraryView } from "../src/main/services/libraryView.ts";
import type { Obj } from "../src/features/realSpeech/domain.ts";
function wav(duration = 7.8) {
  const n = Math.round(duration * 48000);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(96000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "repair-"));
  const s = new RealSpeechService(root);
  return {
    s,
    root,
    t: s.newTask({
      originalText: "第一句。第二句。第三句。第四句。",
      voiceRef: "voice",
    }),
  };
};
const trial = (s: RealSpeechService, t: Obj, duration = 7.8) =>
  s.generate(
    { taskId: t.taskId, taskRevision: t.taskRevision, rehearsal: true },
    async (_snap, path) => {
      writeFileSync(path, wav(duration));
      return { duration };
    },
  );
const approve = (s: RealSpeechService, t: Obj) =>
  s.feedback({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    type: "rehearsal",
    data: true,
  });
test("修复：7.8秒及范围外有效试演可确认，缺失文件与无效时长拒绝", async () => {
  const { s, t } = fixture();
  let next = await trial(s, t);
  next = approve(s, next);
  assert.equal(next.rehearsalPassed, true);
  next = await trial(s, next, 16);
  next = approve(s, next);
  assert.equal(next.rehearsalPassed, true);
  writeFileSync(next.rehearsal.results.at(-1).path,"corrupted");
  assert.throws(()=>approve(s,next),/损坏/);
  unlinkSync(next.rehearsal.results.at(-1).path);
  assert.throws(() => approve(s, next), /缺失/);
  next.rehearsal.results.at(-1).duration = 0;
  s.save(next);
  assert.throws(() => approve(s, next), /无效/);
  s.close();
});
test("修复：参数变化后旧試演不能放行；新试演失败撤销原通过", async () => {
  const { s, t } = fixture();
  let n = await trial(s, t);
  n = approve(s, n);
  n = s.update({
    taskId: n.taskId,
    taskRevision: n.taskRevision,
    window: { windowId: "GW001", rate: 1.2 },
  });
  assert.throws(() => approve(s, n), /旧参数/);
  n = await trial(s, n);
  n = approve(s, n);
  await assert.rejects(
    s.generate(
      { taskId: n.taskId, taskRevision: n.taskRevision, rehearsal: true },
      async () => {
        throw Error("mock failure");
      },
    ),
  );
  assert.equal(s.get(n.taskId).rehearsalPassed, false);
  s.close();
});
test("修复：第二窗口試演采用自己的参数；跨窗口拒绝且不调用模型", async () => {
  const { s, t } = fixture();
  let n = s.update({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    manualGroups: [
      ["U001", "U002"],
      ["U003", "U004"],
    ],
  });
  n = s.update({
    taskId: n.taskId,
    taskRevision: n.taskRevision,
    window: { windowId: "GW002", rate: 1.3, instruction: "坚定快速" },
  });
  n = s.update({
    taskId: n.taskId,
    taskRevision: n.taskRevision,
    rehearsalUnitIds: ["U003", "U004"],
  });
  n = await s.generate(
    { taskId: n.taskId, taskRevision: n.taskRevision, rehearsal: true },
    async (snap, path) => {
      assert.equal(snap.rate, 1.3);
      assert.equal(snap.instruction, "坚定快速");
      writeFileSync(path, wav());
      return { duration: 7.8 };
    },
  );
  n = s.update({
    taskId: n.taskId,
    taskRevision: n.taskRevision,
    rehearsalUnitIds: ["U002", "U003"],
  });
  let calls = 0;
  await assert.rejects(
    s.generate(
      { taskId: n.taskId, taskRevision: n.taskRevision, rehearsal: true },
      async () => {
        calls++;
        return { duration: 10 };
      },
    ),
    /跨越/,
  );
  assert.equal(calls, 0);
  s.close();
});
test("修复：新建与修改原稿保留历史结果；删除原稿变更前待修复动作", async () => {
  const { s, t } = fixture();
  let n = await trial(s, t);
  n.pendingAction = { windowIds: ["GW001"] };
  s.save(n);
  n = s.update({
    taskId: n.taskId,
    taskRevision: n.taskRevision,
    originalText: "新的原稿。",
    name: "新标题",
    goal: "坚定快慢",
  });
  assert.equal(n.pendingAction, null);
  assert.equal(n.name, "新标题");
  assert.equal(n.goal, "坚定快慢");
  assert.ok(
    n.archives
      .flatMap((a: Obj) => a.windows)
      .some((w: Obj) => w.windowId === "REHEARSAL"),
  );
  s.close();
});
test("修复：音频幂等入库→删除任务→重启→独立资产与来源快照仍可访问", async () => {
  const root = mkdtempSync(join(tmpdir(), "assets-repair-"));
  const app = new Application(
    root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    async () => ({ duration: 7.8, sampleRate: 48000 }),
    () => {},
    () => {},
    async () => {
      throw Error("no network");
    },
  );
  let s = new RealSpeechService(root, app);
  let t = s.newTask({ originalText: "第一句。", voiceRef: "voice" });
  t = await trial(s, t);
  await s.syncAssets();
  await s.syncAssets();
  assert.equal(app.db.one<Obj>("SELECT count(*) n FROM assets")!.n, 1);
  const file = t.rehearsal.results[0].path;
  await s.remove({ taskId: t.taskId, taskRevision: t.taskRevision });
  assert.equal(s.list().length, 0);
  assert.ok(existsSync(file));
  assert.throws(() => s.get(t.taskId), /删除/);
  s.close();
  s = new RealSpeechService(root, app);
  await s.syncAssets();
  const rows = await libraryView(app, s, { kind: "audio", source: "assets" });
  assert.equal(rows.total, 1);
  assert.equal(
    rows.items[0].deleted,
    true,
    JSON.stringify({
      rows,
      original: app.assets.get(rows.items[0].id).metadata,
    }),
  );
  const asset = app.assets.get(rows.items[0].id);
  assert.equal(await app.assets.verify(asset), file);
  assert.equal(
    JSON.parse(asset.metadata!.realSpeechSources)[0].snapshot.rate,
    1,
  );
  s.close();
  app.close();
});
test("修复：资产同步失败禁止删除，文件缺失保留独立记录", async () => {
  const { s, t } = fixture();
  let n = await trial(s, t);
  const original = s.syncAssets.bind(s);
  s.syncAssets = async () => {
    throw Error("disk failure");
  };
  await assert.rejects(
    s.remove({ taskId: n.taskId, taskRevision: n.taskRevision }),
    /disk/,
  );
  assert.equal(s.list().length, 1);
  s.syncAssets = original;
  unlinkSync(n.rehearsal.results[0].path);
  await s.remove({ taskId: n.taskId, taskRevision: n.taskRevision });
  assert.equal(s.db.prepare("SELECT count(*) n FROM audio_assets").get()?.n, 1);
  s.close();
});
test("修复：数据库升级重复打开不丢数据，旧无绑定通过状态撤销", () => {
  const { s, root, t } = fixture();
  t.rehearsalPassed = true;
  s.save(t);
  s.close();
  for (let i = 0; i < 2; i++) {
    const next = new RealSpeechService(root);
    assert.equal(next.get(t.taskId).rehearsalPassed, false);
    assert.equal(next.db.prepare("PRAGMA user_version").get()?.user_version, 2);
    next.close();
  }
});
test("统一资产库：类型、分组、搜索、分页、隐藏恢复与普通任务原详情", async () => {
  const root = mkdtempSync(join(tmpdir(), "library-repair-"));
  const app = new Application(
    root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    async () => ({}),
    () => {},
    () => {},
    async () => {
      throw Error("offline");
    },
  );
  const s = new RealSpeechService(root, app);
  const account = app.credentials.save({
    name: "离线",
    providerId: "alibaba",
    key: "fake",
    workspaceId: "ws-test",
    region: "cn-beijing",
  });
  const ids = [];
  for (let i = 0; i < 26; i++) {
    const d = {
      ...app.newDraft(),
      accountId: account.id,
      name: "任务" + i,
      prompt: "可检索的提示词",
      params: { ...app.newDraft().params, duration: 5 },
    };
    const t = await app.tasks.create(d, "lib-" + i, undefined, true);
    ids.push(t.id);
  }
  let rows = await libraryView(app, s, { kind: "video", source: "tasks" });
  assert.equal(rows.total, 26);
  assert.equal(rows.items.length, 24);
  rows = await libraryView(app, s, { kind: "video", source: "tasks", page: 2 });
  assert.equal(rows.items.length, 2);
  rows = await libraryView(app, s, {
    kind: "video",
    source: "tasks",
    search: ids[0],
  });
  assert.equal(rows.total, 1);
  const replica = [{ id: "R1", name: "复刻分段", taskIds: ids.slice(0, 2) }];
  rows = await libraryView(
    app,
    s,
    { kind: "video", source: "tasks", module: "一键复刻" },
    replica,
  );
  assert.equal(rows.total, 1);
  assert.equal(rows.items[0].ids.length, 2);
  assert.equal(rows.items[0].children?.[0].id, ids[0]);
  rows = await libraryView(
    app,
    s,
    {
      kind: "video",
      source: "tasks",
      module: "一键复刻",
      hiddenIds: ["replica:R1"],
    },
    replica,
  );
  assert.equal(rows.total, 0);
  rows = await libraryView(
    app,
    s,
    {
      kind: "video",
      source: "tasks",
      module: "一键复刻",
      hiddenIds: ["replica:R1"],
      showHidden: true,
    },
    replica,
  );
  assert.equal(rows.total, 1);
  assert.equal(
    (await libraryView(app, s, { kind: "audio", source: "tasks" })).total,
    0,
  );
  s.close();
  app.close();
});
test("复制请求：默认文字导出不复制WAV，绑定更新且声明未附音频", async () => {
  const { s, t } = fixture();
  const n = await trial(s, t);
  const out = s.exportTask(
    { taskId: n.taskId, kind: "Director" },
    "resources/docs",
  );
  assert.ok(out.text.includes("本次仅复制文字，未附音频"));
  assert.equal(
    readdirSync(out.dir).filter((x) => x.endsWith(".wav")).length,
    0,
  );
  const before = out.task.exportId;
  const next = s.exportTask(
    { taskId: n.taskId, kind: "Diagnosis", attachments: true },
    "resources/docs",
  );
  assert.notEqual(next.task.exportId, before);
  assert.equal(
    readdirSync(next.dir).filter((x) => x.endsWith(".wav")).length,
    1,
  );
  s.close();
});
test('相同音频多版本：首份文件丢失后改用仍存在的副本，保留全部来源',async()=>{const root=mkdtempSync(join(tmpdir(),'same-audio-'));const app=new Application(root,{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},async()=>({duration:7.8}),()=>{},()=>{},async()=>{throw Error('offline');});const s=new RealSpeechService(root,app);let t=s.newTask({originalText:'一句。',voiceRef:'voice'});t=await trial(s,t);const first=t.rehearsal.results[0].path;t=await trial(s,t);const second=t.rehearsal.results[1].path;unlinkSync(first);t.assetSyncError="previous sync failed";s.save(t);await s.syncAssets();assert.equal(s.get(t.taskId).assetSyncError,undefined);const row=app.db.one<Obj>('SELECT id FROM assets')!;const asset=app.assets.get(row.id);assert.equal(await app.assets.verify(asset),second);assert.equal(JSON.parse(asset.metadata!.realSpeechSources).length,2);s.close();app.close();});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CapabilityRegistry,
  objectSchema,
} from "../src/main/capabilities/registry.ts";
import {
  registerDiscovery,
  controlResponse,
} from "../src/main/capabilities/runtime.ts";
import { registerJobs } from "../src/main/capabilities/jobs.ts";
import { Application } from "../src/main/services/application.ts";
import { libraryView } from "../src/main/services/libraryView.ts";
import { brand } from "../src/shared/brand.ts";
import { APP_VERSION } from "../src/features/realSpeech/domain.ts";
import { ffmpegBinary } from "../src/main/services/transcode.ts";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const root = () => mkdtempSync(join(tmpdir(), "ctg-v142-"));
test("v142 all product version sources match the lockfile and source VERSION", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  assert.equal(pkg.version, "1.5.0");
  for (const value of [
    lock.version,
    lock.packages[""].version,
    brand.version,
    APP_VERSION,
    readFileSync("VERSION", "utf8").trim(),
  ])
    assert.equal(value, pkg.version);
});
test("v142 discovery returns few descriptors and exactly one complete schema", async () => {
  const r = new CapabilityRegistry();
  registerDiscovery(r);
  for (let i = 0; i < 100; i++)
    r.register(
      {
        id: "tasks.test" + i,
        description: "后台 task",
        service: "test",
        effect: "read",
        inputSchema: objectSchema(),
        outputSchema: {},
      },
      () => null,
    );
  const found = await r.executeCapability({
    capability: "capability.search",
    params: { query: "tasks", limit: 3 },
  });
  assert.equal((found.result as any[]).length, 3);
  assert.equal((found.result as any[])[0].inputSchema, undefined);
  const described = await r.executeCapability({
    capability: "capability.describe",
    params: { id: "tasks.test0" },
  });
  assert.equal((described.result as any).inputSchema.type, "object");
  assert.equal(
    (
      await r.executeCapability({
        capability: "capability.search",
        params: { query: "tasks", limit: 99 },
      })
    ).status,
    "failed",
  );
});
test("v142 compact only affects returned control result and retains complete input locally", async () => {
  const r = new CapabilityRegistry(),
    dir = root();
  let received: any;
  r.register(
    {
      id: "local.echo",
      description: "echo",
      service: "test",
      effect: "read",
      inputSchema: { type: "object" },
      outputSchema: {},
    },
    (p) => {
      received = structuredClone(p);
      return {
        taskId: "a",
        status: "Completed",
        outputPath: "D:/final.mp4",
        prompt: p.prompt,
        plan: p.plan,
        providerPayload: p,
        media: "data:video/mp4;base64,AAAA",
      };
    },
  );
  const params = {
    prompt: "完整原稿".repeat(1000),
    plan: {
      windows: [{ text: "原始窗口", voice: "voice-1", params: { speed: 1.1 } }],
    },
    references: ["a.mp4"],
    duration: 2,
  };
  const req = { capability: "local.echo", params };
  const raw = await r.executeCapability(req);
  const compact: any = controlResponse(dir, req, raw);
  assert.deepEqual(received, params);
  assert.equal(compact.taskId, "a");
  assert.equal(compact.outputPath, "D:/final.mp4");
  assert.equal(compact.result, undefined);
  const stored = JSON.parse(readFileSync(compact.resultPath, "utf8"));
  assert.deepEqual(stored.result.plan, params.plan);
  assert.equal(stored.result.prompt, params.prompt);
  assert(!JSON.stringify(stored).includes("base64,"));
  assert(JSON.stringify(compact).length < JSON.stringify(raw).length / 10);
  const normal: any = controlResponse(
    dir,
    { ...req, responseMode: "normal" },
    { ...raw, executionId: "normal-test" },
  );
  assert.equal(normal.result.prompt, params.prompt);
  assert.equal(normal.logs, undefined);
  const debug: any = controlResponse(
    dir,
    { ...req, responseMode: "debug" },
    raw,
  );
  assert.equal(debug.result.prompt, params.prompt);
  assert.equal(
    (await r.executeCapability({ ...req, responseMode: "bad" as any })).status,
    "failed",
  );
});
test("v142 jobs.wait times out without resend then returns completion, reads stay live", async () => {
  const r = new CapabilityRegistry();
  registerJobs(r, root());
  let calls = 0;
  let finish!: () => void;
  r.register(
    {
      id: "local.slow",
      description: "slow",
      service: "test",
      effect: "write",
      inputSchema: objectSchema(),
      outputSchema: {},
    },
    async () => {
      calls++;
      await new Promise<void>((resolve) => (finish = resolve));
      return { outputPath: "D:/done.wav" };
    },
  );
  const submitted: any = (
    await r.executeCapability({
      capability: "jobs.submit",
      params: { requestId: "slow1", request: { capability: "local.slow" } },
    })
  ).result;
  const timed: any = (
    await r.executeCapability({
      capability: "jobs.wait",
      params: { jobId: submitted.jobId, timeout: 0 },
    })
  ).result;
  assert.equal(timed.timedOut, true);
  assert.equal(calls, 1);
  const waiting = r.executeCapability({
    capability: "jobs.wait",
    params: { jobId: submitted.jobId, timeout: 1000 },
  });
  setTimeout(finish, 30);
  const done: any = (await waiting).result;
  assert.equal(done.status, "succeeded");
  assert.equal(done.timedOut, false);
  assert.equal(done.result.result.outputPath, "D:/done.wav");
  assert.equal(calls, 1);
  assert.equal(
    (
      await r.executeCapability({
        capability: "jobs.wait",
        params: { jobId: "missing" },
      })
    ).status,
    "failed",
  );
});
test("v142 persisted result logs have default line limit and reject path traversal", async () => {
  const dir = root(),
    r = new CapabilityRegistry();
  registerDiscovery(r, dir);
  const raw = await r.executeCapability({
    capability: "capability.describe",
    params: { id: "capability.search" },
  });
  const response: any = controlResponse(
    dir,
    { capability: "capability.describe" },
    raw,
  );
  const read: any = (
    await r.executeCapability({
      capability: "logs.read",
      params: { executionId: raw.executionId, lines: 3 },
    })
  ).result;
  assert.equal(read.lines.length, 3);
  assert(existsSync(response.resultPath));
  assert.equal(
    (
      await r.executeCapability({
        capability: "logs.read",
        params: { executionId: "../../secret" },
      })
    ).status,
    "failed",
  );
});
test("v142 asset hide preserves file and missing state; sources classify without rewriting", async () => {
  const dir = root();
  const app = new Application(
    dir,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    async () => ({}),
    () => {},
    () => {},
    async () => {
      throw Error("network forbidden");
    },
  );
  try {
    const file = join(dir, "image.png");
    writeFileSync(
      file,
      Buffer.from([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 2,
        208, 0, 0, 5, 0, 2, 0,
      ]),
    );
    const a = (await app.assets.import(file, false)).asset;
    const before = JSON.stringify(app.assets.get(a.id));
    const list = await libraryView(app, undefined, {
      source: "all",
      kind: "image",
      origin: "upload",
    });
    assert.equal(list.items[0].origin, "upload");
    assert.equal(JSON.stringify(app.assets.get(a.id)), before);
    app.db.set("library-hidden", [a.id]);
    assert.equal(
      (await libraryView(app, undefined, { source: "all", kind: "image" }))
        .total,
      0,
    );
    assert.equal(
      (await libraryView(app, undefined, { source: "all", hidden: true }))
        .items[0].id,
      a.id,
    );
    assert(existsSync(file));
    app.db.set("library-hidden", []);
    app.assets.removeRecords([a.id]);
    assert.equal((await app.assets.list({ hidden: true })).total, 1);
    app.assets.save({ ...app.assets.get(a.id), libraryDeletedAt: null });
    assert.equal((await app.assets.list({ kind: "image" })).total, 1);
    assert(existsSync(file));
    app.assets.save({
      ...app.assets.get(a.id),
      metadata: { source: "generated", taskId: "historic-task" },
    });
    assert.equal(
      (
        await libraryView(app, undefined, {
          source: "assets",
          origin: "generated",
        })
      ).items[0].origin,
      "generated",
    );
  } finally {
    app.close();
  }
});
test("v142 native FFmpeg thumbnails regenerate corrupted cache without changing video", async () => {
  const dir = root(),
    app = new Application(
      dir,
      {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString(),
      },
      async () => ({ duration: 1 }),
      () => {},
      () => {},
      async () => {
        throw Error("network forbidden");
      },
    );
  try {
    const file = join(dir, "real.mp4");
    execFileSync(
      ffmpegBinary(),
      [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x240:r=25:d=1",
        "-c:v",
        "libx264",
        file,
      ],
      { windowsHide: true },
    );
    const original = readFileSync(file);
    const a = (await app.assets.import(file, false)).asset;
    await app.thumbnails.pending;
    const thumb = app.assets.get(a.id).thumbnailPath!;
    assert(existsSync(thumb));
    assert(
      readFileSync(thumb)
        .subarray(0, 2)
        .equals(Buffer.from([255, 216])),
    );
    writeFileSync(thumb, "corrupt");
    app.thumbnails.enqueue(app.assets.get(a.id), true);
    await app.thumbnails.pending;
    assert(
      readFileSync(thumb)
        .subarray(0, 2)
        .equals(Buffer.from([255, 216])),
    );
    assert.deepEqual(readFileSync(file), original);
  } finally {
    app.close();
  }
});

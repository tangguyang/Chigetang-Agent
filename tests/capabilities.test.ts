import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CapabilityRegistry,
  objectSchema,
} from "../src/main/capabilities/registry.ts";
import { SecretFilter } from "../src/cli/output.ts";
import { registerApplicationCapabilities } from "../src/main/capabilities/catalog.ts";
import { registerSpeechCapabilities } from "../src/main/capabilities/speech.ts";
import { registerJobs } from "../src/main/capabilities/jobs.ts";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("capabilities validate before service calls and deny UI/key endpoints", async () => {
  const r = new CapabilityRegistry();
  let calls = 0;
  registerApplicationCapabilities(r, async () => {
    calls++;
    return true;
  });
  registerSpeechCapabilities(r, async () => {
    calls++;
    return true;
  });
  for (const req of [
    { capability: "assets.import", params: {} },
    { capability: "tools.audio", params: { path: "a", format: "exe" } },
    { capability: "tasks.create", params: { draft: {}, requestId: "a" } },
    { capability: "accounts.reveal", params: { id: "a" } },
    { capability: "dialog.directory" },
    { capability: "voices.remove", params: { id: "a" } },
    {
      capability: "tools.audio",
      params: { path: "a", format: "wav", extra: 1 },
    },
  ])
    assert.equal((await r.executeCapability(req)).status, "failed");
  assert.equal(calls, 0);
  assert.equal(
    (
      await r.executeCapability({
        capability: "assets.import",
        params: { paths: ["a"] },
      })
    ).status,
    "succeeded",
  );
  assert.equal(calls, 1);
  assert.equal(new Set(r.list().map((x) => x.id)).size, r.list().length);
  assert.ok(r.list().length > 90);
});
test("async jobs return early, deduplicate and survive process reload without replay", async () => {
  const root = mkdtempSync(join(tmpdir(), "ctg-jobs-"));
  const r = new CapabilityRegistry();
  let calls = 0,
    release!: () => void;
  r.register(
    {
      id: "long",
      description: "",
      service: "test",
      effect: "write",
      inputSchema: objectSchema(),
      outputSchema: {},
    },
    async () => {
      calls++;
      await new Promise<void>((y) => (release = y));
      return true;
    },
  );
  registerJobs(r, root);
  const submit = {
    capability: "jobs.submit",
    params: { requestId: "stable-request", request: { capability: "long" } },
  };
  const first = await r.executeCapability(submit);
  assert.equal(first.status, "succeeded");
  const jobId = (first.result as any).jobId;
  const again = await r.executeCapability(submit);
  assert.equal((again.result as any).jobId, jobId);
  assert.equal(calls, 1);
  const pending = await r.executeCapability({
    capability: "jobs.status",
    params: { jobId },
  });
  assert.equal((pending.result as any).status, "queued");
  const restored = new CapabilityRegistry();
  registerJobs(restored, root);
  const unknown = await restored.executeCapability({
    capability: "jobs.status",
    params: { jobId },
  });
  assert.equal((unknown.result as any).status, "unknown");
  release();
  await new Promise((y) => setTimeout(y, 20));
  const done = await r.executeCapability({
    capability: "jobs.status",
    params: { jobId },
  });
  assert.equal((done.result as any).status, "succeeded");
});
test("queue serializes writes, survives failures and removes secrets", async () => {
  const f = new SecretFilter();
  f.remember("my-private-test-value");
  const r = new CapabilityRegistry(f);
  let active = 0,
    max = 0;
  r.register(
    {
      id: "slow",
      description: "",
      service: "test",
      effect: "write",
      inputSchema: objectSchema(),
      outputSchema: {},
    },
    async () => {
      active++;
      max = Math.max(active, max);
      await new Promise((y) => setTimeout(y, 10));
      active--;
      return { key: "private", message: "my-private-test-value" };
    },
  );
  const result = await Promise.all([
    r.executeCapability({ capability: "missing" }),
    r.executeCapability({ capability: "slow" }),
    r.executeCapability({ capability: "slow" }),
  ]);
  assert.equal(max, 1);
  assert.equal(result[0].status, "failed");
  assert.equal(result[1].status, "succeeded");
  assert.deepEqual(result[1].result, { message: "[REDACTED]" });
});
test("workflow resolves references, prechecks paid approval and stops after failure", async () => {
  const r = new CapabilityRegistry();
  let calls = 0;
  r.register(
    {
      id: "echo",
      description: "",
      service: "test",
      effect: "write",
      inputSchema: objectSchema({ value: { type: "string" } }, ["value"]),
      outputSchema: {},
    },
    (p) => {
      calls++;
      return p;
    },
  );
  r.register(
    {
      id: "paid",
      description: "",
      service: "test",
      effect: "paid",
      inputSchema: objectSchema(),
      outputSchema: {},
    },
    () => {
      calls++;
      return true;
    },
  );
  r.registerWorkflow();
  const denied = await r.executeCapability({
    capability: "workflow.run",
    params: {
      steps: [
        { id: "one", capability: "echo", params: { value: "a" } },
        { id: "two", capability: "paid" },
      ],
    },
  });
  assert.equal(denied.status, "failed");
  assert.equal(calls, 0);
  const success = await r.executeCapability({
    capability: "workflow.run",
    params: {
      steps: [
        { id: "one", capability: "echo", params: { value: "hello" } },
        {
          id: "two",
          capability: "echo",
          params: { value: { $ref: "one.result.value" } },
        },
      ],
    },
  });
  assert.equal(success.status, "succeeded");
  assert.equal(calls, 2);
  const fail = await r.executeCapability({
    capability: "workflow.run",
    params: {
      steps: [
        { id: "one", capability: "echo", params: {} },
        { id: "two", capability: "echo", params: { value: "never" } },
      ],
    },
  });
  assert.equal(fail.status, "failed");
  assert.equal(calls, 2);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { RealSpeechV2Service } from "../src/main/realSpeech/v2/service.ts";
import { SpeechAgentControl } from "../src/main/realSpeech/v2/agentControl.ts";
import { SecretFilter } from "../src/cli/output.ts";
import { runCli } from "../src/cli/run.ts";
import { acquireWriter } from "../src/main/realSpeech/v2/writerLease.ts";
import {
  startControlBridge,
  bridgeMetadata,
  requestBridge,
} from "../src/main/realSpeech/v2/controlPipe.ts";
import {
  acceptanceAdapter,
  acceptanceMode,
} from "../src/main/realSpeech/v2/ipcAcceptance.ts";
const projectRoot = resolve(".");
async function cli(root: string, args: string[]) {
  let stdout = "",
    stderr = "";
  const code = await runCli(
    ["speech", ...args, "--data-root", root, "--json"],
    {
      projectRoot,
      paidApp: async () => {
        throw Error("IPC不得打开凭据或创建独立Service");
      },
      stdout: (s) => (stdout += s),
      stderr: (s) => (stderr += s),
    },
  );
  return { code, data: JSON.parse(stdout), stderr };
}
test(
  "Windows原生IPC：共用一个Service，确认、V1/V2、选择回滚、只读结构与脱敏",
  { skip: process.platform !== "win32" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "ctg-pipe-test-")),
      s = new RealSpeechV2Service(root),
      release = acquireWriter(root);
    const task = s.importPlan({
      name: "IPC fake",
      voiceRef: "offline",
      text: readFileSync(
        "resources/real-speech-v2/examples/plan-l0-baseline.json",
        "utf8",
      ),
      confirmed: true,
    });
    let notifications = 0,
      failures = 0;
    const stop = await startControlBridge(
      root,
      projectRoot,
      () => new SpeechAgentControl(s, acceptanceAdapter),
      () => notifications++,
      new SecretFilter(),
      () => failures++,
    );
    try {
      assert.throws(() => acquireWriter(root), /已有写入者/);
      const context = await cli(root, [
        "context",
        "--task",
        task.taskId,
        "--window",
        "GW002",
      ]);
      assert.equal(context.code, 0, context.stderr);
      assert.equal(context.data.data.schema, "REAL_SPEECH_AGENT_CONTEXT_V1");
      assert.equal(
        (
          await cli(root, [
            "generate",
            "--task",
            task.taskId,
            "--window",
            "GW002",
          ])
        ).code,
        1,
      );
      assert.equal(s.get(task.taskId).windows[1].versions.length, 0);
      const direct = await requestBridge(
        root,
        ["speech", "generate", "--task", task.taskId, "--window", "GW002"],
        projectRoot,
      );
      assert.equal(direct.ok, false);
      assert.match(direct.error.message, /confirm/);
      assert.equal(s.get(task.taskId).windows[1].versions.length, 0);
      const generation = await cli(root, [
        "generate",
        "--task",
        task.taskId,
        "--window",
        "GW002",
        "--confirm",
      ]);
      assert.equal(generation.code, 0, generation.stderr);
      const current = s.get(task.taskId),
        w = current.windows[1],
        v = w.versions[0];
      const patch = {
        schema: "REAL_SPEECH_EXECUTION_PATCH_V2",
        protocolVersion: current.plan.protocolVersion,
        capabilityProfileId: current.plan.capabilityProfileId,
        capabilityVersion: current.plan.capabilityVersion,
        patchId: crypto.randomUUID(),
        taskId: task.taskId,
        basePlanId: current.plan.planId,
        basePlanHash: current.planHash,
        targetWindowIds: ["GW002"],
        expectedVersions: [
          {
            windowId: "GW002",
            configRevision: w.configRevision,
            selectedVersionId: v.versionId,
            selectedVersionHash: v.fileHash,
          },
        ],
        changes: [
          {
            windowId: "GW002",
            set: { seed: 1235 },
            executionConfidence: current.plan.windows[1].executionConfidence,
          },
        ],
        lockedWindows: [],
        diagnosis: {
          evidenceBasis: "text_only",
          listenedVersionIds: [],
          summary: "IPC离线测试",
          issues: [
            {
              windowId: "GW002",
              dimension: "readingFeel",
              observation: "不评价音质",
              certainty: "unverified",
            },
          ],
        },
        validationFocus: [{ windowId: "GW002", focus: "IPC与版本" }],
        changeIsolationPolicy: "ONE_PRIMARY_VARIABLE_AT_A_TIME",
      };
      const file = join(root, "patch.json");
      writeFileSync(file, JSON.stringify(patch));
      const preview = await cli(root, [
        "patch-preview",
        "--task",
        task.taskId,
        "--file",
        file,
      ]);
      assert.equal(preview.code, 0, preview.stderr);
      assert.equal(s.db.prepare("SELECT count(*) n FROM jobs").get()?.n, 1);
      const args = [
        "patch-apply",
        "--task",
        task.taskId,
        "--file",
        file,
        "--preview-hash",
        preview.data.data.previewHash,
        "--confirm",
      ];
      assert.equal((await cli(root, args)).code, 0);
      assert.equal((await cli(root, args)).data.data.reused, true);
      const versions = (
        await cli(root, [
          "versions",
          "--task",
          task.taskId,
          "--window",
          "GW002",
        ])
      ).data.data;
      assert.deepEqual(
        versions.map((v: any) => v.versionNumber),
        [2, 1],
      );
      for (const v of versions) {
        assert.equal(
          (
            await cli(root, [
              "select",
              "--task",
              task.taskId,
              "--window",
              "GW002",
              "--version",
              v.versionId,
            ])
          ).code,
          0,
        );
        assert.equal(
          s.get(task.taskId).windows[1].selectedVersionId,
          v.versionId,
        );
      }
      assert.equal(
        (
          await cli(root, [
            "rollback",
            "--task",
            task.taskId,
            "--window",
            "GW002",
            "--version",
            versions[1].versionId,
          ])
        ).code,
        0,
      );
      assert(existsSync(versions[0].path));
      assert.equal(s.get(task.taskId).windows[0].versions.length, 0);
      assert.equal(s.get(task.taskId).windows[2].versions.length, 0);
      assert(notifications >= 8);
      assert.equal(failures, 0);
      const metadata = bridgeMetadata(root)!;
      const bad = spawnSync(
        join(projectRoot, "dist/agent-control/local-pipe.exe"),
        ["--client", metadata.pipeName, String(metadata.pipeHostPid + 1)],
        { encoding: "utf8", input: "{}\n", windowsHide: true, timeout: 10000 },
      );
      assert.notEqual(bad.status, 0);
      assert.equal(bad.stdout, "");
    } finally {
      stop();
      s.close();
      release();
    }
    assert.equal(
      (await cli(root, ["context", "--task", task.taskId, "--window", "GW002"]))
        .data.data.schema,
      "REAL_SPEECH_AGENT_CONTEXT_V1",
    );
  },
);
test("Writer租约跨进程互斥；验收fake模式拒绝生产路径", () => {
  const root = mkdtempSync(join(tmpdir(), "ctg-writer-test-")),
    release = acquireWriter(root);
  try {
    assert.throws(() => acquireWriter(root), /已有写入者/);
    const code = `import{acquireWriter}from ${JSON.stringify(pathToFileURL(resolve("src/main/realSpeech/v2/writerLease.ts")).href)};try{acquireWriter(${JSON.stringify(root)});process.exitCode=1;}catch{process.stdout.write('BLOCKED');}`;
    const child = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", code],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "BLOCKED");
  } finally {
    release();
  }
  const again = acquireWriter(root);
  again();
  assert.throws(
    () =>
      acceptanceMode(["--agent-control-acceptance"], {
        CHIGETANG_AGENT_ACCEPTANCE_ROOT: projectRoot,
      }),
    /临时目录/,
  );
});

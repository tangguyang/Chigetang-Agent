import {
  CapabilityRegistry,
  objectSchema,
  stringSchema as s,
  type Params,
} from "./registry.ts";
// These adapters call the exact dispatcher used by the GUI; business validation
// remains in the existing Services. Dialog/clipboard/key-reveal are excluded.
export function registerApplicationCapabilities(
  registry: CapabilityRegistry,
  invoke: (id: string, p: Params) => Promise<unknown>,
) {
  const b = { type: "boolean" },
    obj = { type: "object" },
    strings = { type: "array", items: s, maxItems: 1000 };
  const add = (
    id: string,
    properties: Params = {},
    required: string[] = [],
    effect: "read" | "write" | "paid" | "destructive" = "read",
    open = false,
  ) =>
    registry.register(
      {
        id,
        description: "后台执行 " + id,
        service: "Application / " + id,
        inputSchema: objectSchema(properties, required, open),
        outputSchema: {},
        effect,
      },
      (p) => invoke(id, p),
    );
  add('library.hide',{id:s,hidden:b},['id'],'write');
  add("audio.qwen.generate", {
    model: { const: "qwen-audio-3.0-tts-plus" }, voice: s, text: s, instruction: s, outputPath: s, accountId: s,
    rate: { type: "number", minimum: 0.5, maximum: 2 },
    pitch: { type: "number", minimum: 0.5, maximum: 2 },
    volume: { type: "integer", minimum: 0, maximum: 100 },
    seed: { type: "integer", minimum: 0, maximum: 65535 },
  }, ["model", "voice", "text", "instruction", "outputPath"], "paid");
  add("audio.qwen.clone", { referencePath: s, name: s, prefix: s, language: { const: "zh" }, accountId: s }, ["referencePath", "name", "prefix", "language"], "paid");
  add('assets.thumbnail.ensure',{id:s,force:b},['id'],'write');
  for (const id of [
    "bootstrap",
    "audio.capabilities",
    "audio.batches",
    "audio.presets",
    "audio.history",
    "audio.reclone.draft",
    "voices.list",
    "folders.list",
    "replica.list",
    "packages.list",
    "packages.stage1Info",
    "draft.new",
    "draft.list",
    "draft.get",
    "transcription.progress",
    "assets.refresh",
    "tasks.refreshAll",
    "backup",
  ])
    add(
      id,
      {},
      [],
      ["draft.new", "assets.refresh", "tasks.refreshAll", "backup"].includes(id)
        ? "write"
        : "read",
    );
  for (const id of [
    "assets.list",
    "library.list",
    "prompts.list",
    "tasks.list",
    "billing.report",
    "statistics",
  ])
    add(
      id,
      {
        query: s,
        search: s,
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 1000 },
      },
      [],
      id === "library.list" ? "write" : "read",
      true,
    );
  for (const id of [
    "assets.get",
    "assets.inspect",
    "draft.load",
    "tasks.get",
    "tasks.versions",
    "tasks.children",
    "prompts.versions",
    "billing.history",
    "accounts.balance",
    "accounts.test",
    "replica.preflight",
    "audio.reclone.prepare",
  ])
    add(
      id,
      { id: s, parentId: s, taskId: s, modelId: s },
      [
        id === "tasks.children"
          ? "parentId"
          : id === "audio.reclone.prepare"
            ? "taskId"
            : "id",
      ],
      id.includes("inspect") ||
        id.includes("prepare") ||
        id.includes("preflight")
        ? "write"
        : "read",
    );
  add(
    "assets.import",
    {
      paths: { type: "array", items: s, minItems: 1, maxItems: 100 },
      copy: b,
      projectId: s,
      folder: s,
      kind: s,
    },
    ["paths"],
    "write",
  );
  add(
    "assets.save",
    {
      id: s,
      name: s,
      folder: s,
      tags: strings,
      favorite: b,
      projectId: { type: ["string", "null"] },
      remoteUrl: s,
      defaultUsage: s,
    },
    ["id"],
    "write",
  );
  add("assets.relocate", { id: s, path: s }, ["id", "path"], "write");
  add("assets.relocateFolder", { id: s, path: s }, ["id", "path"], "write");
  add(
    "tools.audio",
    { path: s, format: { enum: ["mp3", "wav"] }, directory: s },
    ["path", "format"],
    "write",
  );
  add(
    "video.frames",
    {
      path: s,
      directory: s,
      interval: { type: "number", minimum: 0.1, maximum: 3600 },
      count: { type: "integer", minimum: 1, maximum: 500 },
    },
    ["path"],
    "write",
  );
  add(
    "video.convert",
    { path: s, directory: s, format: { enum: ["mp4", "mkv", "mov"] } },
    ["path", "format"],
    "write",
  );
  add(
    "media.trim",
    {
      path: s,
      directory: s,
      start: { type: "number", minimum: 0 },
      duration: { type: "number", exclusiveMinimum: 0, maximum: 86400 },
      kind: { enum: ["video", "audio"] },
      format: { enum: ["mp4", "wav"] },
    },
    ["path", "start", "duration", "kind", "format"],
    "write",
  );
  add(
    "video.concat",
    {
      paths: { type: "array", items: s, minItems: 1, maxItems: 100 },
      audio: s,
      directory: s,
    },
    ["paths"],
    "write",
  );
  add(
    "audio.convert",
    { path: s, directory: s, format: { enum: ["mp3", "wav"] } },
    ["path", "format"],
    "write",
  );
  add(
    "image.process",
    {
      path: s,
      output: s,
      width: { type: "integer", minimum: 1, maximum: 8192 },
      height: { type: "integer", minimum: 1, maximum: 8192 },
      format: { enum: ["png", "jpg"] },
      quality: { type: "integer", minimum: 1, maximum: 100 },
    },
    ["path", "output", "format"],
    "write",
  );
  add(
    "files.export",
    { assetId: s, taskId: s, output: s },
    ["output"],
    "write",
  );
  add(
    "text.process",
    {
      text: { type: "string", maxLength: 1000000 },
      operation: { enum: ["trim", "normalize", "identity"] },
    },
    ["text", "operation"],
  );
  add(
    "text.subtitles",
    {
      segments: {
        type: "array",
        maxItems: 10000,
        items: objectSchema(
          {
            startMs: { type: "number", minimum: 0 },
            endMs: { type: "number", minimum: 0 },
            text: s,
          },
          ["startMs", "endMs", "text"],
        ),
      },
      output: s,
    },
    ["segments", "output"],
    "write",
  );
  for (const id of ["transcription.inspect", "transcription.start"])
    add(id, { path: s }, ["path"], id.endsWith("start") ? "write" : "read");
  add("transcription.cancel", {}, [], "write");
  add(
    "transcription.result",
    { taskId: s, kind: { enum: ["full", "timeline"] } },
    ["taskId", "kind"],
  );
  add("transcription.wait", {}, []);
  add("transcription.run", { path: s }, ["path"], "write");
  for (const id of [
    "replica.import",
    "packages.import",
    "packages.stage1Inspect",
  ])
    add(id, { path: s }, ["path"], "write");
  add("replica.compile", { path: s, output: s }, ["path", "output"], "write");
  add("packages.compileTemplate", { output: s }, ["output"], "write");
  add(
    "packages.exportGuide",
    {
      kind: {
        enum: [
          "stage1",
          "stage2",
          "converter",
          "spec",
          "singleTemplate",
          "multiTemplate",
        ],
      },
      output: s,
    },
    ["kind", "output"],
    "write",
  );
  for (const id of ["packages.detail", "packages.preflight"])
    add(id, { sessionId: s }, ["sessionId"],id.endsWith('preflight')?'write':'read');
  add(
    "replica.update",
    { id: s, segmentId: s, draft: obj },
    ["id", "segmentId", "draft"],
    "write",
  );
  add(
    "packages.update",
    { sessionId: s, segmentId: s, patch: obj },
    ["sessionId", "segmentId", "patch"],
    "write",
  );
  add(
    "replica.confirm",
    { id: s, revision: { type: "integer", minimum: 1 } },
    ["id", "revision"],
    "write",
  );
  add(
    "packages.confirm",
    { sessionId: s, revision: { type: "integer", minimum: 1 } },
    ["sessionId", "revision"],
    "write",
  );
  add("replica.submit", { id: s }, ["id"], "paid");
  add("packages.submit", { sessionId: s }, ["sessionId"], "paid");
  add("packages.stage1Apply", { token: s, allowLegacy: b }, ["token"], "write");
  add("packages.stage1Restore", {}, [], "write");
  for (const id of [
    "draft.save",
    "prompts.save",
    "audio.presets.save",
    "folders.save",
    "models.save",
    "voices.save",
  ])
    add(id, {}, [], "write", true);
  for (const id of ["draft.rename", "audio.job.rename"])
    add(id, { id: s, name: s }, ["id", "name"], "write");
  add(
    "audio.history.favorite",
    { id: s, favorite: b },
    ["id", "favorite"],
    "write",
  );
  for (const id of ["audio.presets.reorder", "voices.reorder"])
    add(id, { ids: strings }, ["ids"], "write");
  for (const id of [
    "draft.remove",
    "draft.finishSubmitted",
    "assets.remove",
    "audio.job.delete",
    "audio.presets.delete",
    "audio.history.delete",
    "voices.remove",
    "folders.remove",
    "tasks.remove",
  ])
    add(id, { id: s }, ["id"], "destructive");
  add("assets.removeMany", { ids: strings }, ["ids"], "destructive");
  add("packages.discard", { sessionId: s }, ["sessionId"], "destructive");
  add("audio.reclone.clear", {}, [], "write");
  add(
    "audio.bind",
    { assetId: s, draftId: s },
    ["assetId", "draftId"],
    "write",
  );
  add(
    "audio.batch.create",
    {
      accountId: s,
      voiceId: s,
      name: s,
      text: s,
      requestId: s,
      configs: { type: "array", items: obj, minItems: 1, maxItems: 100 },
    },
    ["accountId", "voiceId", "name", "text", "requestId", "configs"],
    "paid",
    true,
  );
  add(
    "voices.clone",
    { accountId: s, assetId: s, name: s },
    ["accountId", "assetId", "name"],
    "paid",
    true,
  );
  add("audio.batch.retry", { id: s }, ["id"], "paid");
  for (const id of ["tasks.create", "tasks.segment.create"])
    add(id, { draft: obj, requestId: s, ...(id==='tasks.create'?{deferQueue:b}:{}) }, ["draft", "requestId"], "paid");
  for (const id of ["tasks.again", "tasks.segment.retry"])
    add(id, { id: s, requestId: s }, ["id", "requestId"], "paid");
  add("tasks.clone", { id: s, independent: b }, ["id"], "write");
  add("tasks.resume", { id: s, apiTaskId: s }, ["id"], "paid");
  for (const id of ["tasks.cancel", "tasks.redownload", "tasks.refreshStatus"])
    add(id, { id: s }, ["id"], "write");
  for (const id of ["tasks.estimate", "tasks.segment.plan"])
    add(id, {}, [], "read", true);
  add("projects.create", { name: s, outputDir: s }, ["name"], "write");
  add(
    "billing.correct",
    { id: s, amount: { type: ["number", "null"] }, note: s },
    ["id", "amount"],
    "write",
  );
  // Settings/account secrets and reset actions remain human administration.
}

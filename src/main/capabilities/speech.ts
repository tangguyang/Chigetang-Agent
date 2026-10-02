import {
  CapabilityRegistry,
  objectSchema,
  stringSchema as s,
  type Params,
} from "./registry.ts";
export function registerSpeechCapabilities(
  registry: CapabilityRegistry,
  invoke: (action: string, p: Params) => Promise<unknown>,
) {
  const add = (
    id: string,
    fields: Params,
    required: string[],
    effect: "read" | "write" | "paid" | "destructive" = "read",
    open = false,
  ) =>
    registry.register(
      {
        id: "speech." + id,
        description: "真人口播 " + id,
        service: "RealSpeechV2Service / " + id,
        inputSchema: objectSchema(fields, required, open),
        outputSchema: {},
        effect,
      },
      (p) => invoke("v2:" + id, p),
    );
  add("list", {}, []);
  add("get", { taskId: s }, ["taskId"]);
  add("preview", { text: s }, ["text"]);
  add(
    "import",
    {
      name: s,
      voiceRef: s,
      text: s,
      confirmed: { const: true },
      experimentalConfirmed: { type: "boolean" },
    },
    ["name", "voiceRef", "text", "confirmed"],
    "write",
  );
  for (const id of ["mutate", "acknowledge", "recover"])
    add(id, { taskId: s }, ["taskId"], "write", true);
  add("patchPreview", { taskId: s }, ["taskId"], "read", true);
  add("patchApply", { taskId: s }, ["taskId"], "paid", true);
  add("generate", { taskId: s }, ["taskId"], "paid", true);
  add("concat", { taskId: s }, ["taskId"], "write", true);
  add("export", { taskId: s }, ["taskId"], "write", true);
  for (const id of [
    "list",
    "get",
    "create",
    "remove",
    "update",
    "preview",
    "apply",
    "generate",
    "recover",
    "concat",
    "feedback",
    "export",
    "document",
  ]) {
    const effect =
      id === "generate"
        ? "paid"
        : id === "remove"
          ? "destructive"
          : ["get", "preview", "document"].includes(id)
            ? "read"
            : "write";
    registry.register(
      {
        id: "speech.legacy." + id,
        description: "旧版真人口播 " + id,
        service: "RealSpeechService / " + id,
        effect,
        inputSchema: objectSchema({}, [], true),
        outputSchema: {},
      },
      (p) => invoke(id, p),
    );
  }
}

// Local-only visual acceptance harness. No real network model requests or credentials.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { Application } from "../src/main/services/application.ts";
import type { Draft, Asset, ListQuery } from "../src/shared/types.ts";
const key = randomBytes(32),
  root = mkdtempSync(join(tmpdir(), "v104-visual-"));
const vault = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([iv, c.update(s), c.final(), c.getAuthTag()]);
  },
  decryptString: (b: Buffer) => {
    const c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    c.setAuthTag(b.subarray(-16));
    return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString();
  },
};
const app = new Application(
  root,
  vault,
  async (_p, k) => ({
    width: 720,
    height: 1280,
    duration: k === "video" ? 11 : undefined,
    fps: 30,
  }),
  () => {},
  () => {},
  async () => {
    throw Error("No external API permitted in QA harness");
  },
);
app.credentials.save({
  name: "演示账户",
  providerId: "alibaba",
  workspaceId: "ws-fixture",
  key: "visual-test-only",
});
const assets: Asset[] = [];
for (let i = 0; i < 45; i++) {
  const file = join(root, `产品包装素材-${i}-长名称显示省略.png`);
  writeFileSync(
    file,
    Buffer.concat([
      readFileSync("resources/brand.png"),
      Buffer.from(String(i)),
    ]),
  );
  assets.push((await app.assets.import(file, false)).asset);
}
const video = (
  await app.assets.import(resolve("tests/fixtures/sample.mp4"), false)
).asset;
for (let i = 0; i < 46; i++)
  app.prompts.save({
    name: `产品展示 Prompt ${i + 1}`,
    content: "固定镜头，保持包装细节完整。",
  });
for (let i = 0; i < 42; i++) {
  const d = {
    ...app.newDraft(),
    name: `视频测试任务 ${i + 1}`,
    prompt: "模拟任务",
    params: { ...app.newDraft().params, duration: 12 },
  };
  const t = await app.tasks.create(d, "visual-task-" + i);
  t.submittedAt = new Date().toISOString();
  t.status = "Completed";
  app.tasks.save(t);
  app.drafts.remove(d.draftId!);
}
app.db.run("DELETE FROM drafts");
const d = app.newDraft();
app.saveDraft({
  ...d,
  name: "产品视频方案",
  prompt: "保持人物和产品的细节。".repeat(120),
  params: { ...d.params, duration: 12 },
  assets: [
    ...assets
      .slice(0, 6)
      .map((a, i) => ({
        assetId: a.id,
        role: "reference_image" as const,
        bindingId: `image-${i}`,
        userRole: "包装正面",
      })),
    { assetId: video.id, role: "reference_video", bindingId: "video" },
  ],
});
const dir = process.argv[2]!;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, "http://127.0.0.1");
    if (url.pathname === "/invoke") {
      let raw = "";
      for await (const b of req) raw += b;
      const { action, payload: p = {} } = JSON.parse(raw);
      let value: unknown;
      switch (action) {
        case "bootstrap":
          value = app.bootstrap();
          break;
        case "draft.save":
          value = app.saveDraft(p as Draft);
          break;
        case "draft.new":
          value = app.newDraft();
          break;
        case "draft.list":
          value = app.drafts.list();
          break;
        case "draft.load":
          value = app.drafts.get(p.id);
          break;
        case "draft.rename":
          value = app.drafts.rename(p.id, p.name);
          break;
        case "draft.finishSubmitted":
          app.drafts.remove(p.id);
          value = true;
          break;
        case "tasks.estimate":
          value = app.tasks.estimate(p);
          break;
        case "tasks.list":
          value = app.tasks.list(p as ListQuery);
          break;
        case "tasks.create":
          value = await app.tasks.create(p.draft, p.requestId);
          break;
        case "assets.get":
          value = app.assets.get(p.id);
          break;
        case "assets.list":
          value = await app.assets.list(p);
          break;
        case "assets.save":
          app.assets.save({ ...app.assets.get(p.id), ...p });
          value = app.assets.get(p.id);
          break;
        case "prompts.list":
          value = app.prompts.list(p);
          break;
        case "billing.report":
          value = app.billing.report(p);
          break;
        case "billing.history":
          value = app.billing.history(p.id);
          break;
        case "billing.correct":
          app.billing.correct(p.id, p.amount, p.note);
          value = true;
          break;
        case "statistics":
          value = app.statistics(p);
          break;
        case "settings.save":
          value = await app.saveSettings(p);
          break;
        default:
          throw Error("Unexpected QA operation " + action);
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, data: value }));
      return;
    }
    let file =
      url.pathname === "/" ? join(dir, "index.html") : join(dir, url.pathname);
    if (url.pathname.startsWith("/media/")) {
      const a = app.assets.get(url.pathname.split("/").at(-1)!);
      file = a.managedPath || a.originalPath;
    }
    const mime: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".png": "image/png",
      ".mp4": "video/mp4",
    };
    res.setHeader(
      "Content-Type",
      mime[extname(file)] || "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
});
server.listen(4178, "127.0.0.1", () =>
  console.log("QA_READY http://127.0.0.1:4178"),
);
process.on("SIGTERM", () => {
  server.close();
  app.close();
  process.exit();
});

// Development-only renderer QA against the real application/database. No cloud requests or keys.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { Application } from "../src/main/services/application.ts";
import type {
  Draft,
  Settings,
  Prompt,
  ListQuery,
} from "../src/shared/types.ts";
const root = resolve("test-data/ui-qa");
const app = new Application(
  root,
  {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error("QA: key entry disabled");
    },
    decryptString: () => {
      throw new Error("QA: keys unavailable");
    },
  },
  async () => ({}),
  () => {},
  () => {},
);
const bridge = `window.aiVideo={invoke:async(action,payload)=>{const r=await fetch('/qa-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})});const v=await r.json();if(!v.ok)throw new Error(v.error);return v.data},onChange:()=>()=>{},onNavigate:()=>()=>{},filePath:()=>''};`;
createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/qa-api") {
      if (req.headers.origin && req.headers.origin !== "http://127.0.0.1:4173")
        throw new Error("Invalid origin");
      let body = "";
      for await (const c of req) body += String(c);
      const { action, payload: p } = JSON.parse(body) as {
        action: string;
        payload: Record<string, unknown>;
      };
      let data: unknown;
      switch (action) {
        case "bootstrap":
          data = app.bootstrap();
          break;
        case "draft.new":
          data = app.newDraft();
          break;
        case "draft.list":
          data = app.drafts.list();
          break;
        case "draft.load":
          data = app.drafts.get(String(p.id));
          break;
        case "tasks.estimate":
          data = app.tasks.estimate(p as unknown as Draft);
          break;
        case "draft.save":
          data = app.saveDraft(p as unknown as Draft);
          break;
        case "settings.save":
          data = await app.saveSettings(p as Partial<Settings>);
          break;
        case "assets.list":
          data = await app.assets.list(p as ListQuery);
          break;
        case "prompts.list":
          data = app.prompts.list(p as ListQuery);
          break;
        case "prompts.save":
          data = app.prompts.save(p as unknown as Prompt);
          break;
        case "prompts.versions":
          data = app.prompts.versions(String(p.id));
          break;
        case "tasks.list":
          data = app.tasks.list(p as ListQuery);
          break;
        case "projects.create":
          data = app.createProject(String(p.name));
          break;
        case "statistics":
          data = app.statistics(p);
          break;
        case "dialog.confirm":
          data = true;
          break;
        case "models.save":
          data = app.updateModel(String(p.id), p);
          break;
        case "backup":
          data = await app.db.backupTo(
            join(root, "backups", `${Date.now()}.sqlite`),
          );
          break;
        default:
          throw new Error(
            "Desktop-only operation unavailable in UI QA harness",
          );
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, data }));
      return;
    }
    if (req.url === "/qa-bridge.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bridge);
      return;
    }
    const path = resolve(
      "dist/renderer",
      "." + (req.url === "/" ? "/index.html" : req.url || ""),
    );
    if (!path.startsWith(resolve("dist/renderer") + "/"))
      throw new Error("Invalid path");
    let content = await readFile(path);
    if (extname(path) === ".html")
      content = Buffer.from(
        content
          .toString()
          .replace("<head>", '<head><script src="/qa-bridge.js"></script>'),
      );
    res.setHeader(
      "Content-Type",
      (
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
        } as Record<string, string>
      )[extname(path)] || "application/octet-stream",
    );
    res.end(content);
  } catch (e) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}).listen(4173, "127.0.0.1", () =>
  console.log("UI QA on port 4173; cloud generation disabled"),
);

import { app, net, safeStorage } from "electron";
import { mkdtempSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../main/services/application.ts";
import { AudioService } from "../main/services/audio.ts";
import { CredentialManager } from "../main/services/credentials.ts";
import { runCli } from "./run.ts";
import { WINDOWS_DATA_ROOT } from "../main/services/storage.ts";
import { SecretFilter } from "./output.ts";

// Headless Electron is used only for the existing OS vault and net.fetch.
// No Application constructor, BrowserWindow, scheduler, account save, or new key store.
const filter = new SecretFilter(),
  temp = mkdtempSync(join(tmpdir(), "chigetang-cli-vault-"));
const args = process.argv.slice(2),
  i = args.indexOf("--data-root");
const root = i >= 0 ? resolve(args[i + 1] || "") : WINDOWS_DATA_ROOT;
try {
  mkdirSync(join(temp, "chromium"));
  copyFileSync(
    join(root, "config/chromium/Local State"),
    join(temp, "chromium/Local State"),
  );
  app.setPath("userData", join(temp, "chromium"));
} catch {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      schema: "CHIGETANG_AGENT_CLI_RESULT_V1",
      command: args[1] || "unknown",
      error: {
        code: "VAULT_UNAVAILABLE",
        message: "现有系统凭据状态不可读取；未调用云端",
      },
    }) + "\n",
  );
  app.exit(1);
}
void app
  .whenReady()
  .then(async () => {
    const code = await runCli(args, {
      projectRoot:
        process.env.CHIGETANG_PROJECT_ROOT || resolve(__dirname, "../.."),
      filter,
      paidApp: async (dataRoot, redactor) => {
        const db = new DatabaseSync(
          join(dataRoot, "database/ai-video.sqlite"),
          { readOnly: true },
        );
        db.exec("PRAGMA query_only=ON");
        const facade = {
          all: (sql: string, ...p: any[]) => db.prepare(sql).all(...p),
          one: (sql: string, ...p: any[]) => db.prepare(sql).get(...p),
          get: (key: string, fallback: unknown) => {
            const r = db
              .prepare("SELECT data FROM settings WHERE key=?")
              .get(key);
            return r ? JSON.parse(String(r.data)) : fallback;
          },
        };
        const application = Object.assign(
          Object.create(Application.prototype),
          {
            db: facade,
            root: dataRoot,
            origins: facade.get("rootOrigins", []),
            fetcher: (input: any, init: any) =>
              net.fetch(input instanceof URL ? input.href : input, init),
            changed: () => {},
            logger: undefined,
          },
        ) as Application;
        application.audio = Object.assign(
          Object.create(AudioService.prototype),
          { app: application },
        );
        application.credentials = new CredentialManager(
          facade as any,
          safeStorage,
        );
        const original = application.credentials.getKey.bind(
          application.credentials,
        );
        application.credentials.getKey = (id: string) => {
          const key = original(id);
          redactor.remember(key);
          return key;
        };
        return { app: application, close: () => db.close() };
      },
    });
    // The target is our own uniquely-created temp directory, verified before cleanup.
    const rel = relative(resolve(tmpdir()), resolve(temp));
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
      try {
        rmSync(temp, { recursive: true, force: true });
      } catch {}
    }
    app.exit(code);
  })
  .catch(() => {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        schema: "CHIGETANG_AGENT_CLI_RESULT_V1",
        error: {
          code: "CLI_RUNTIME_FAILED",
          message: "本地CLI运行器失败；请检查本地配置，禁止自动重试",
        },
      }) + "\n",
    );
    app.exit(1);
  });

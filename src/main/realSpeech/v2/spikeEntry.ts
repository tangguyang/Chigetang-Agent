import { app, net, safeStorage } from "electron";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CredentialManager } from "../../services/credentials.ts";
import { HttpClient, secureURL } from "../../providers/http.ts";
import { validateWorkspace } from "../../../shared/accounts.ts";
import { ffmpegBinary } from "../../services/transcode.ts";
import { loadBatch, dryRun, executeBatch } from "./spike.ts";
import { sha256, strictJSON } from "./validator.ts";
const args = process.argv.slice(2),
  arg = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? "" : args[i + 1] || "";
  };
const root = arg("--data-root") || "D:\\吃个糖Agent数据库";
const batch = loadBatch(resolve("resources/real-speech-v2/spike/batch1.json"));
if (!args.includes("--execute-approved") && !args.includes("--preflight")) {
  console.log(JSON.stringify(dryRun(batch), null, 2));
  app.exit(0);
} else
  app.whenReady().then(async () => {
    let db: DatabaseSync | undefined;
    try {
      const source = arg("--credential-source") || "vault";
      let binding: any, getKey: () => string;
      if (source === "vault") {
        db = new DatabaseSync(join(root, "database", "ai-video.sqlite"), {
          readOnly: true,
        });
        const readOnly = {
          all: (sql: string) => db!.prepare(sql).all(),
          one: (sql: string, ...values: any[]) =>
            db!.prepare(sql).get(...values),
        };
        const credentials = new CredentialManager(readOnly as any, safeStorage);
        const ref = arg("--voice-ref");

        const settings = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all();
        // Voice metadata uses the existing audio.voices key in the key-value store.
        const table = settings.map((r) => String(r.name));
        let voices: any[] = [];
        if (table.includes("cosy_voices"))
          voices = db
            .prepare("SELECT data FROM cosy_voices")
            .all()
            .map((r) => JSON.parse(String(r.data)));
        if (!voices.length)
          throw Error("音色表不可用，先在软件复刻音色；禁止自动创建收费音色");
        if (args.includes("--preflight") && !ref) {
          console.log(
            JSON.stringify(
              {
                status: "READ_ONLY_NO_NETWORK_SELECT_VOICE",
                voices: voices
                  .filter(
                    (v) =>
                      v.kind === "clone" &&
                      v.status === "ready" &&
                      v.model === batch.model,
                  )
                  .map((v) => ({
                    voiceRef: v.id,
                    name: v.name,
                    remoteVoice: v.voiceId,
                    accountId: v.accountId,
                    model: v.model,
                    region: v.region,
                  })),
                matrix: dryRun(batch),
              },
              null,
              2,
            ),
          );
          app.exit(0);
          return;
        }
        if (!ref) throw Error("指定 --voice-ref 现有本地音色标识");
        const voice = voices.find((v) => v.id === ref);
        const account = credentials
          .list()
          .find((a) => a.id === voice?.accountId);
        if (
          !voice?.voiceId ||
          voice.kind !== "clone" ||
          voice.status !== "ready" ||
          voice.model !== batch.model ||
          !account?.enabled ||
          account.region !== "cn-beijing"
        )
          throw Error("音色与北京账户不匹配");
        if (!safeStorage.isEncryptionAvailable())
          throw Error("系统凭据加密不可用");
        binding = {
          voiceRef: ref,
          voice: voice.voiceId,
          accountId: account.id,
          workspaceId: account.workspaceId,
        };
        getKey = () => credentials.getKey(account.id);
      } else if (source === "env") {
        binding = {
          voiceRef: process.env.COSYVOICE_SPIKE_VOICE_REF,
          voice: process.env.COSYVOICE_SPIKE_VOICE_ID,
          accountId: "environment",
          workspaceId: process.env.COSYVOICE_SPIKE_WORKSPACE_ID,
        };
        getKey = () => process.env.DASHSCOPE_API_KEY || "";
        if (!binding.voiceRef || !binding.voice)
          throw Error("缺少环境变量音色绑定，必须是已有克隆音色");
      } else throw Error("只允许vault或env凭据");
      validateWorkspace(binding.workspaceId || "");
      binding.url = `https://${binding.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`;
      if (args.includes("--preflight")) {
        console.log(
          JSON.stringify(
            {
              status: "READ_ONLY_NO_NETWORK",
              binding,
              encryptedCredentialSource: source,
              matrix: dryRun(batch),
            },
            null,
            2,
          ),
        );
        app.exit(0);
        return;
      }
      const approvalPath = arg("--approval");
      if (!approvalPath) throw Error("缺少明确批准文件");
      const approval = strictJSON(readFileSync(approvalPath, "utf8"));
      const fetcher: typeof fetch = (input, init) =>
        net.fetch(input instanceof URL ? input.href : input, init);
      const ffmpeg = ffmpegBinary();
      const ledger = await executeBatch(batch, approval, binding, {
        executeApproved: true,
        outputRoot: join(root, "real-speech-v2", "spike"),
        getKey,
        submit: async (url, key, body) =>
          (await new HttpClient(fetcher, undefined, 0).request(url, key, {
            method: "POST",
            paidSubmit: true,
            body,
          })) as any,
        download: async (url, path) => {
          const safe = secureURL(String(url).replace(/^http:/, "https:"));
          if (!safe.hostname.endsWith(".aliyuncs.com"))
            throw Error("非官方音频地址");
          const r = await fetcher(safe, {
            redirect: "error",
            signal: AbortSignal.timeout(120000),
          });
          if (!r.ok) throw Error("音频下载失败");
          const { writeFileSync } = await import("node:fs");
          writeFileSync(path, Buffer.from(await r.arrayBuffer()), {
            flag: "wx",
          });
        },
        pcmHash: async (path) => {
          const { stdout } = await promisify(execFile)(
            ffmpeg,
            [
              "-nostdin",
              "-v",
              "error",
              "-i",
              path,
              "-f",
              "s16le",
              "-acodec",
              "pcm_s16le",
              "-",
            ],
            {
              windowsHide: true,
              encoding: "buffer",
              timeout: 120000,
              maxBuffer: 64 * 1024 * 1024,
            },
          );
          return sha256(stdout);
        },
      });
      console.log(
        JSON.stringify(
          {
            status: ledger.status,
            actualCalls: ledger.actualCalls,
            actualCostCny: ledger.actualCostCny,
          },
          null,
          2,
        ),
      );
      app.exit(0);
    } catch {
      console.error(
        "Spike未执行或已停止：检查凭据绑定/批准文件/脱敏ledger；无自动重试。",
      );
      app.exit(1);
    } finally {
      db?.close();
    }
  });

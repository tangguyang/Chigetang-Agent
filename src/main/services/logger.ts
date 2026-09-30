import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
export class Logger {
  root: string;
  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
    for (const f of ["application", "api", "task", "error", "download"])
      appendFileSync(join(root, `${f}.log`), "");
  }
  write(
    channel: string,
    event: string,
    meta: Record<string, string | number | boolean | null> = {},
  ) {
    const allowed = ["application", "api", "task", "error", "download"];
    const file = join(
      this.root,
      `${allowed.includes(channel) ? channel : "application"}.log`,
    );
    const clean = Object.fromEntries(
      Object.entries(meta)
        .filter(([k]) => !/key|token|prompt|authorization|url|payload/i.test(k))
        .map(([k, v]) => [
          k,
          typeof v === "string"
            ? v
                .replace(/Bearer\s+\S+|sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
                .slice(0, 300)
            : v,
        ]),
    );
    try {
      if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024)
        renameSync(file, file + ".1");
      appendFileSync(
        file,
        JSON.stringify({ time: new Date().toISOString(), event, ...clean }) +
          "\n",
      );
    } catch {
      /* Logging must not interrupt persistence. */
    }
  }
}

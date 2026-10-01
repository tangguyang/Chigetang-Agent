import { resolve } from "node:path";
import { runCli } from "./run.ts";
process.exitCode = await runCli(process.argv.slice(2), {
  projectRoot: resolve(import.meta.dirname, "../.."),
});

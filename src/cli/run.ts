import { resolve } from "node:path";
import type { Application } from "../main/services/application.ts";
import {
  RealSpeechV2Service,
  type Adapter,
} from "../main/realSpeech/v2/service.ts";
import { SpeechAgentControl } from "../main/realSpeech/v2/agentControl.ts";
import { assertCoordinatedDesktop } from "../main/realSpeech/v2/runtimeCoordination.ts";
import { WINDOWS_DATA_ROOT } from "../main/services/storage.ts";
import { parseArgs, commands, writeCommand, paidCommand } from "./args.ts";
import { SecretFilter, resultOutput } from "./output.ts";

export type CliDependencies = {
  projectRoot: string;
  filter?: SecretFilter;
  adapter?: Adapter;
  paidApp?: (
    root: string,
    filter: SecretFilter,
  ) => Promise<{ app: Application; close: () => void }>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
};
export async function runCli(argv: string[], deps: CliDependencies) {
  const filter = deps.filter || new SecretFilter(),
    out = deps.stdout || ((s: string) => process.stdout.write(s)),
    err = deps.stderr || ((s: string) => process.stderr.write(s));
  let service: RealSpeechV2Service | undefined,
    closeApp: (() => void) | undefined,
    command = "unknown";
  try {
    const args = parseArgs(argv);
    command = args.command;
    if (command === "help") {
      out(
        resultOutput(
          command,
          {
            commands,
            usage: "node scripts/chigetang.mjs speech <command> --json",
            confirmation:
              "Paid actions require explicit human approval before --confirm",
            httpServer: false,
          },
          filter,
        ),
      );
      return 0;
    }
    const root = resolve(args.values["data-root"] || WINDOWS_DATA_ROOT),
      resources = resolve(deps.projectRoot, "resources/real-speech-v2");
    if (writeCommand(command) || command === "export-diagnosis")
      assertCoordinatedDesktop(root);
    let app: Application | undefined;
    if (paidCommand(command) && !deps.adapter) {
      if (!deps.paidApp) throw Error("付费动作必须使用受控Electron凭据运行器");
      const opened = await deps.paidApp(root, filter);
      app = opened.app;
      closeApp = opened.close;
    }
    service = new RealSpeechV2Service(
      root,
      app,
      resources,
      writeCommand(command) ? "existingWrite" : "readOnly",
    );
    const result = await new SpeechAgentControl(service, deps.adapter).execute(
      args,
    );
    out(resultOutput(command, result, filter));
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    out(resultOutput(command, message, filter, true));
    err(filter.text(message) + "\n");
    return 1;
  } finally {
    service?.close();
    closeApp?.();
  }
}

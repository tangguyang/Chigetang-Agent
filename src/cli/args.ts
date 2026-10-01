export const commands = [
  "tasks",
  "show",
  "window",
  "context",
  "diagnose",
  "versions",
  "export-diagnosis",
  "patch-preview",
  "patch-apply",
  "generate",
  "select",
  "rollback",
  "concat",
] as const;
export type Command = (typeof commands)[number];
export type Args = {
  command: Command | "help";
  values: Record<string, string>;
  flags: Set<string>;
};
const common = ["json", "data-root"];
const allowed: Record<Command, string[]> = {
  tasks: [],
  show: ["task"],
  window: ["task", "window"],
  context: ["task", "window"],
  diagnose: ["task", "window"],
  versions: ["task", "window"],
  "export-diagnosis": ["task", "window", "feedback", "task-revision"],
  "patch-preview": ["task", "file"],
  "patch-apply": [
    "task",
    "file",
    "preview-hash",
    "confirm",
    "experimental-confirm",
  ],
  generate: [
    "task",
    "window",
    "task-revision",
    "confirm",
    "experimental-confirm",
  ],
  select: ["task", "window", "version", "task-revision"],
  rollback: ["task", "window", "version", "task-revision"],
  concat: ["task", "task-revision", "confirm"],
};
const switches = new Set(["json", "confirm", "experimental-confirm"]);
export function parseArgs(argv: string[]): Args {
  if (!argv.length || argv.includes("--help"))
    return { command: "help", values: {}, flags: new Set() };
  if (argv[0] !== "speech" || !commands.includes(argv[1] as Command))
    throw Error("用法：chigetang speech <command> --json；未知命令");
  const command = argv[1] as Command,
    values: Record<string, string> = {},
    flags = new Set<string>(),
    seen = new Set<string>();
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].startsWith("--") ? argv[i].slice(2) : "";
    if (![...common, ...allowed[command]].includes(key) || seen.has(key))
      throw Error("未知或重复参数：" + argv[i]);
    seen.add(key);
    if (switches.has(key)) flags.add(key);
    else {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw Error("参数缺少值：--" + key);
      values[key] = value;
    }
  }
  if (command !== "tasks" && !values.task) throw Error("缺少 --task");
  if (
    [
      "window",
      "context",
      "diagnose",
      "versions",
      "generate",
      "select",
      "rollback",
      "export-diagnosis",
    ].includes(command) &&
    !/^GW\d{3,}$/.test(values.window || "")
  )
    throw Error("缺少有效 --window（例如 GW002）");
  if (["patch-preview", "patch-apply"].includes(command) && !values.file)
    throw Error("缺少 --file");
  if (["select", "rollback"].includes(command) && !values.version)
    throw Error("缺少 --version");
  if (
    ["generate", "patch-apply", "concat"].includes(command) &&
    !flags.has("confirm")
  )
    throw Error("需要用户明确确认后提供 --confirm；未执行任何动作");
  if (
    command === "patch-apply" &&
    !/^[a-f0-9]{64}$/.test(values["preview-hash"] || "")
  )
    throw Error("缺少有效 --preview-hash；先预览并确认Diff");
  if (values["task-revision"] && !/^[1-9]\d*$/.test(values["task-revision"]))
    throw Error("无效 --task-revision");
  return { command, values, flags };
}
export const writeCommand = (command: string) =>
  ["generate", "patch-apply", "select", "rollback", "concat"].includes(command);
export const paidCommand = (command: string) =>
  ["generate", "patch-apply"].includes(command);

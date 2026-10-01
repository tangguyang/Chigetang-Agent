import {
  readFileSync,
  existsSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute } from "node:path";

/** Do not open the live source with SQLite: even mode=ro can create WAL/SHM.
 * Two identical full captures include WAL commits, and SQLite itself rebuilds
 * the private snapshot's index. No business SQL or WAL replay is reimplemented.
 */
export function readSnapshot(file: string) {
  const capture = () => ({
    main: readFileSync(file),
    wal: existsSync(file + "-wal") ? readFileSync(file + "-wal") : null,
  });
  let snapshot: ReturnType<typeof capture> | undefined;
  for (let i = 0; i < 3; i++) {
    const a = capture(),
      b = capture();
    if (
      a.main.equals(b.main) &&
      (a.wal === null ? b.wal === null : b.wal !== null && a.wal.equals(b.wal))
    ) {
      snapshot = b;
      break;
    }
  }
  if (!snapshot)
    throw Error("数据库正在变化，未取得一致性只读快照；请稍后重读");
  const temp = mkdtempSync(join(tmpdir(), "ctg-agent-read-")),
    path = join(temp, "snapshot.db");
  const cleanup = () => {
    const rel = relative(resolve(tmpdir()), resolve(temp));
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw Error("拒绝不安全快照清理路径");
    rmSync(temp, { recursive: true, force: true });
  };
  try {
    writeFileSync(path, snapshot.main, { flag: "wx" });
    if (snapshot.wal?.length)
      writeFileSync(path + "-wal", snapshot.wal, { flag: "wx" });
    return { path, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

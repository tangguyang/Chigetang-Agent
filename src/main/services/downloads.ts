import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, mkdir, open, unlink, readdir } from "node:fs/promises";
import { AUTO_VIDEO_NAME, videoStem } from "../../shared/filenames.ts";
import { basename, join, dirname, extname } from "node:path";
import { secureURL } from "../providers/http.ts";
import { AppError } from "./errors.ts";
import type { Logger } from "./logger.ts";
// Serialize only the final filesystem commit, not network downloads.
let publication: Promise<unknown> = Promise.resolve();
async function publish(temporary: string, destination: string) {
  const previous = publication;
  let release!: () => void;
  publication = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  try {
    const dir = dirname(destination);
    const extension = extname(destination).toLowerCase();
    const stem =
      basename(destination) === AUTO_VIDEO_NAME
        ? videoStem("")
        : basename(destination, extension);
    const existing = new Set(
      (await readdir(dir)).map((n) => n.normalize("NFC").toLowerCase()),
    );
    for (let i = 0; ; i++) {
      const name = `${stem}${i ? ` (${i})` : ""}${extension}`;
      if (existing.has(name.toLowerCase())) continue;
      const target = join(dir, name);
      try {
        try {
          await link(temporary, target);
        } catch (e) {
          if (
            ["EPERM", "ENOTSUP", "EXDEV", "EOPNOTSUPP"].includes(
              (e as NodeJS.ErrnoException).code ?? "",
            )
          )
            await copyFile(temporary, target, constants.COPYFILE_EXCL);
          else throw e;
        }
        return target;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
  } finally {
    release();
  }
}
export class DownloadManager {
  logger: Logger;
  timeout: number;
  fetcher: typeof fetch;
  constructor(logger: Logger, timeout = 300000, fetcher: typeof fetch = fetch) {
    this.logger = logger;
    this.timeout = timeout;
    this.fetcher = fetcher;
  }
  async download(url: string, destination: string) {
    secureURL(url);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = join(dirname(destination), `${randomUUID()}.part`);
    let handle;
    try {
      const response = await this.fetcher(url, {
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!response.ok || !response.body)
        throw new AppError(
          "DownloadError",
          "下载地址不可用或已过期，请重新查询云端结果。",
        );
      handle = await open(temporary, "wx");
      let size = 0;
      const reader = response.body.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value;
        size += chunk.length;
        if (size > 4 * 1024 ** 3)
          throw new AppError("DownloadError", "输出超过 4 GB，已停止下载。");
        let offset = 0;
        while (offset < chunk.length) {
          const written = await handle.write(
            chunk,
            offset,
            chunk.length - offset,
          );
          if (!written.bytesWritten)
            throw new AppError(
              "DownloadError",
              "写入文件中断，请检查磁盘空间。",
            );
          offset += written.bytesWritten;
        }
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      const file = await open(temporary, "r");
      const head = Buffer.alloc(32);
      await file.read(head, 0, 32, 0);
      await file.close();
      if (!validArtifactHeader(head, extname(destination), size))
        throw new AppError(
          "DownloadError",
          `下载文件不是有效 ${extname(destination).slice(1).toUpperCase()}，请重新查询云端结果后下载。`,
        );
      destination = await publish(temporary, destination);
      await unlink(temporary);
      this.logger.write("download", "completed", { bytes: size });
      return destination;
    } catch (e) {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      this.logger.write("download", "failed");
      throw e instanceof AppError
        ? e
        : new AppError(
            "DownloadError",
            e instanceof Error && /ENOSPC/.test(e.message)
              ? "磁盘空间不足。云端已生成成功，请释放空间后重新下载。"
              : "结果已生成，但本地下载失败。请检查保存目录、空间或网络后重新下载。",
          );
    }
  }
}

export function validArtifactHeader(
  head: Buffer,
  extension: string,
  size: number,
) {
  if (size < 12) return false;
  const ascii = (a: number, b: number) => head.toString("ascii", a, b);
  switch (extension.toLowerCase()) {
    case ".mp4":
      return size >= 32 && ascii(4, 8) === "ftyp";
    case ".wav":
      return size >= 44 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
    case ".mp3":
      return (
        ascii(0, 3) === "ID3" || (head[0] === 255 && (head[1] & 224) === 224)
      );
    case ".png":
      return head
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case ".jpg":
    case ".jpeg":
      return head[0] === 255 && head[1] === 216 && head[2] === 255;
    default:
      return false;
  }
}

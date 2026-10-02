import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from 'node:fs';
import type { Asset } from "../../shared/types.ts";
import type { Application } from "./application.ts";
import { ffmpegBinary } from "./transcode.ts";
const exec = promisify(execFile);
export class ThumbnailQueue {
  pending = Promise.resolve();
  stopped = false;
  app: Application;
  constructor(app: Application) {
    this.app = app;
  }
  enqueue(asset: Asset,force=false) {
    if (asset.kind !== "video" || (!force&&asset.thumbnailPath && existsSync(asset.thumbnailPath)) || this.stopped) return;
    this.pending = this.pending
      .then(async () => {
        if (this.stopped) return;
        const current = this.app.assets.get(asset.id);
        if (!force&&current.thumbnailPath && existsSync(current.thumbnailPath)) return;
        const folder = join(this.app.root, "cache", "thumbnails");
        await mkdir(folder, { recursive: true });
        const target = join(folder, asset.id + ".jpg");
        try {
          if(force)await unlink(target).catch(()=>{});
          if (!(await stat(target).catch(() => null)))
            await exec(
              ffmpegBinary(this.app.settings().ffmpegPath),
              [
                "-nostdin",
                "-n",
                "-ss",
                String((asset.duration || 1) * 0.15),
                "-i",
                asset.managedPath || asset.originalPath,
                "-frames:v",
                "1",
                "-vf",
                "scale=360:-2",
                target,
              ],
              { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 },
            );
          if (this.stopped) return;
          this.app.assets.save({
            ...this.app.assets.get(asset.id),
            thumbnailPath: target,
          });
          this.app.changed();
        } catch {
          await unlink(target).catch(
            () => {},
          ); /* renderer provides serial codec fallback */
        }
      })
      .catch(() => {});
  }
}

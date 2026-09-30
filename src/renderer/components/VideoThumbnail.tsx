import { Film } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Asset } from "../../shared/types.ts";
import { api, media } from "../store.ts";
// Decode one visible thumbnail at a time, then persist it for subsequent visits.
let pending = Promise.resolve();
const attempted = new Set<string>();
export function VideoThumbnail({ asset }: { asset: Asset }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(Boolean(asset.thumbnailPath));
  useEffect(() => {
    if (asset.thumbnailPath) setReady(true);
  }, [asset.thumbnailPath]);
  useEffect(() => {
    if (ready || attempted.has(asset.id)) return;
    let alive = true;
    const create = async () => {
      if (!alive || attempted.has(asset.id)) return;
      attempted.add(asset.id);
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.preload = "metadata";
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("thumbnail timeout")),
            12000,
          );
          video.onerror = () => {
            clearTimeout(timer);
            reject(new Error("unsupported codec"));
          };
          video.onloadedmetadata = () => {
            video.currentTime = Math.max(0.01, video.duration * 0.15);
          };
          video.onseeked = () => {
            clearTimeout(timer);
            resolve();
          };
          video.src = media("asset", asset.id);
        });
        if (!alive) return;
        const canvas = document.createElement("canvas");
        canvas.width = 360;
        canvas.height = Math.max(
          1,
          Math.round((360 * video.videoHeight) / video.videoWidth),
        );
        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        await api("assets.thumbnail", {
          id: asset.id,
          data: canvas.toDataURL("image/png"),
        });
        if (alive) setReady(true);
      } catch {
        /* A missing thumbnail must never block access to the original asset. */
      } finally {
        video.removeAttribute("src");
        video.load();
      }
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        pending = pending.then(create, create);
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [asset.id, ready]);
  return ready ? (
    <img src={media("thumb", asset.id)} alt={asset.name} loading="lazy" />
  ) : (
    <span ref={ref} className="video-placeholder">
      <Film size={28} />
    </span>
  );
}

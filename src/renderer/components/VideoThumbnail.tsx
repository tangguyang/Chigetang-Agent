import { Film } from "lucide-react";
import { useEffect, useState } from "react";
import type { Asset } from "../../shared/types.ts";
import { api, media } from "../store.ts";
export function VideoThumbnail({ asset }: { asset: Asset }) {
  const [ready, setReady] = useState(Boolean(asset.thumbnailPath)),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    if (!ready)
      void api<Asset>("assets.thumbnail.ensure", {
        id: asset.id,
        force: retry > 0,
      })
        .then((a) => {
          if (live) setReady(Boolean(a.thumbnailPath));
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [asset.id, ready, retry]);
  return ready ? (
    <img
      src={media("thumb", asset.id) + "?revision=" + retry}
      alt={asset.name}
      loading="lazy"
      onError={() => {
        if (retry < 2) {
          setReady(false);
          setRetry((x) => x + 1);
        }
      }}
    />
  ) : (
    <span className="video-placeholder">
      <Film size={28} />
      <button onClick={() => setRetry((x) => x + 1)}>重试缩略图</button>
    </span>
  );
}

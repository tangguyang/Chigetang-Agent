import { mediaInfoFactory } from "mediainfo.js";
import { open } from "node:fs/promises";
import type { Asset } from "../../shared/types.ts";
/** Read bounded chunks locally. No ffmpeg installation or media upload is needed. */
export async function probeMedia(
  path: string,
  wasmPath: string,
): Promise<Partial<Asset>> {
  const file = await open(path, "r");
  const info = await mediaInfoFactory({
    format: "object",
    locateFile: () => wasmPath,
  }).catch(async (error) => {
    await file.close();
    throw error;
  });
  try {
    const { size } = await file.stat();
    const result = await info.analyzeData(size, async (length, offset) => {
      const buffer = Buffer.alloc(Math.min(length, 4 * 1024 * 1024));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      return buffer.subarray(0, bytesRead);
    });
    const tracks = result.media?.track ?? [];
    const visual = tracks.find(
      (t) => t["@type"] === "Video" || t["@type"] === "Image",
    );
    const audio = tracks.find((t) => t["@type"] === "Audio");
    const general = tracks.find((t) => t["@type"] === "General");
    const visualData = (visual ?? {}) as Record<string, unknown>;
    const generalData = (general ?? {}) as Record<string, unknown>;
    const value = (v: unknown) => (Number(v) > 0 ? Number(v) : undefined);
    return {
      width: visual && "Width" in visual ? value(visual.Width) : undefined,
      height: visual && "Height" in visual ? value(visual.Height) : undefined,
      fps:
        visual && "FrameRate" in visual ? value(visual.FrameRate) : undefined,
      sampleRate:
        audio && "SamplingRate" in audio
          ? value(audio.SamplingRate)
          : undefined,
      channels:
        audio && "Channels" in audio ? value(audio.Channels) : undefined,
      bitDepth:
        audio && "BitDepth" in audio ? value(audio.BitDepth) : undefined,
      duration: value(
        general?.Duration ??
          (visual && "Duration" in visual ? visual.Duration : undefined) ??
          audio?.Duration,
      ),
      hasAlpha:
        String(visualData.Alpha ?? visualData.AlphaChannel ?? "").toLowerCase() ===
        "yes",
      metadata: {
        mediaInfoFormat: String(generalData.Format ?? visualData.Format ?? ""),
      },
    };
  } finally {
    info.close();
    await file.close();
  }
}

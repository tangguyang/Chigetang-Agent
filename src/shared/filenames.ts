export const AUTO_VIDEO_NAME = "<auto-video-timestamp>.mp4";
export function videoStem(name: string, now = new Date()) {
  let s = name
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "");
  s = [...s]
    .slice(0, 100)
    .join("")
    .replace(/[. ]+$/g, "");
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(s))
    s = "_" + s;
  if (s) return s;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

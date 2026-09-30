import type { Asset, Draft, Model } from "./types.ts";

export interface WanPreflightIssue {
  code: string;
  title: string;
  actual: string;
  allowed: string;
  solution: string;
  severity: "error" | "warning";
  assetId?: string;
  promptIndex?: number;
}

export interface WanPreflightResult {
  ok: boolean;
  issues: WanPreflightIssue[];
  videoSeconds: number;
  audioSeconds: number;
  outputSeconds: number;
  smartDuration: boolean;
}

const detectedFormat = (asset: Asset) =>
  String(
    asset.metadata?.detectedFormat ||
      asset.name.split(".").pop() ||
      "",
  ).toLowerCase();

export function formatWanIssue(issue: WanPreflightIssue) {
  return `${issue.title}\n实际检测：${issue.actual}\n官方允许：${issue.allowed}\n解决方法：${issue.solution}`;
}

export function wanPreflight(
  model: Model,
  draft: Draft,
  assets: (Asset & { role?: string })[],
): WanPreflightResult {
  const issues: WanPreflightIssue[] = [];
  const add = (issue: Omit<WanPreflightIssue, "severity"> & { severity?: "error" | "warning" }) =>
    issues.push({ severity: "error", ...issue });
  const video = assets.filter((asset) => asset.kind === "video");
  const audio = assets.filter((asset) => asset.kind === "audio");
  const images = assets.filter((asset) => asset.kind === "image");
  const videoSeconds = video.reduce((sum, asset) => sum + Number(asset.duration || 0), 0);
  const audioSeconds = audio.reduce(
    (sum, asset) =>
      sum +
      (asset.role === "reference_audio"
        ? Math.min(Number(asset.duration || 0), 14)
        : Number(asset.duration || 0)),
    0,
  );
  const outputSeconds = Number(draft.params.duration);
  const smartDuration = outputSeconds === -1;
  const frames = assets.filter((asset) => asset.role === "first_frame" || asset.role === "last_frame");
  const references = assets.filter((asset) => asset.role?.startsWith("reference_"));

  if (frames.length && references.length)
    add({
      code: "mixed-modes",
      title: "当前模型不支持首尾帧与全模态参考混用",
      actual: `首尾帧 ${frames.length} 项 + 全模态参考 ${references.length} 项`,
      allowed: "首帧/首尾帧只能与 first_frame、last_frame 组合；不得混入参考图片、视频或音频",
      solution: "切换为自由参考，或移除全部参考素材后仅保留首帧/尾帧。",
    });
  if (assets.filter((asset) => asset.role === "first_frame").length > 1 || assets.filter((asset) => asset.role === "last_frame").length > 1)
    add({
      code: "frame-count",
      title: "首尾帧数量超限",
      actual: `首帧 ${assets.filter((a) => a.role === "first_frame").length} 张，尾帧 ${assets.filter((a) => a.role === "last_frame").length} 张`,
      allowed: "首帧最多 1 张，尾帧最多 1 张",
      solution: "每个槽位仅保留一张图片。",
    });
  if (assets.some((asset) => asset.role === "last_frame") && !assets.some((asset) => asset.role === "first_frame"))
    add({
      code: "last-without-first",
      title: "尾帧缺少首帧",
      actual: "已选择尾帧，但没有首帧",
      allowed: "尾帧必须与首帧同时提供",
      solution: "补充首帧，或移除尾帧。",
    });

  const limits = model.capabilities.limits;
  for (const [kind, list] of [["image", images], ["video", video], ["audio", audio]] as const) {
    const limit = limits[kind];
    if (!limit) continue;
    if (list.length > limit.maxCount)
      add({
        code: `${kind}-count`,
        title: `${kind === "image" ? "参考图片" : kind === "video" ? "参考视频" : "参考音频"}数量超限`,
        actual: `${list.length} 项`,
        allowed: `最多 ${limit.maxCount} 项`,
        solution: `移除 ${list.length - limit.maxCount} 项后再提交。`,
      });
    for (const asset of list) {
      const willTrimAudio =
        kind === "audio" &&
        asset.role === "reference_audio" &&
        Number(asset.duration || 0) > 14;
      const format = detectedFormat(asset);
      if (!limit.extensions.includes(format))
        add({
          code: `${kind}-format`,
          title: `${asset.name} 格式不受支持`,
          actual: format ? format.toUpperCase() : "无法识别真实格式",
          allowed: limit.extensions.map((value) => value.toUpperCase()).join("、"),
          solution: `重新导出为 ${limit.extensions.map((value) => value.toUpperCase()).join(" 或 ")} 后上传。`,
          assetId: asset.id,
        });
      const mb = asset.size / 1024 / 1024;
      if (
        !Number.isFinite(asset.size) ||
        asset.size <= 0 ||
        (!willTrimAudio && mb > limit.maxMB)
      )
        add({
          code: `${kind}-size`,
          title: `${asset.name} 文件大小不合规`,
          actual: asset.size > 0 ? `${mb.toFixed(2)} MB` : "无法读取",
          allowed: `单文件不超过 ${limit.maxMB} MB`,
          solution: "压缩或重新导出文件后上传；软件不会静默截断。",
          assetId: asset.id,
        });
      if (kind !== "audio") {
        if (!asset.width || !asset.height)
          add({
            code: `${kind}-dimensions-missing`,
            title: `${asset.name} 分辨率读取失败`,
            actual: "宽高未知",
            allowed: `单边 ${limit.minSide ?? 1}–${limit.maxSide ?? "不限"} 像素`,
            solution: "重新导出为可解码媒体后上传。",
            assetId: asset.id,
          });
        else {
          const ratio = Math.max(asset.width / asset.height, asset.height / asset.width);
          if (Math.min(asset.width, asset.height) < (limit.minSide ?? 0) || Math.max(asset.width, asset.height) > (limit.maxSide ?? Infinity))
            add({
              code: `${kind}-dimensions`,
              title: `${asset.name} 分辨率不合规`,
              actual: `${asset.width}×${asset.height}`,
              allowed: `单边 ${limit.minSide ?? 1}–${limit.maxSide ?? "不限"} 像素`,
              solution: "调整素材分辨率后重新上传。",
              assetId: asset.id,
            });
          if (ratio > (limit.maxRatio ?? Infinity))
            add({
              code: `${kind}-ratio`,
              title: `${asset.name} 长宽比不合规`,
              actual: `${ratio.toFixed(2)}:1`,
              allowed: `不超过 ${limit.maxRatio}:1`,
              solution: "裁剪画面或增加边缘空间后重新上传。",
              assetId: asset.id,
            });
        }
      }
      if (kind !== "image") {
        if (!asset.duration)
          add({
            code: `${kind}-duration-missing`,
            title: `${asset.name} 时长读取失败`,
            actual: "时长未知",
            allowed: `单段 ${limit.minSeconds}–${limit.maxSeconds} 秒`,
            solution: "重新导出为可解码文件后上传。",
            assetId: asset.id,
          });
        else if (
          asset.duration < (limit.minSeconds ?? 0) ||
          (!willTrimAudio && asset.duration > (limit.maxSeconds ?? Infinity))
        )
          add({
            code: `${kind}-duration`,
            title: `${asset.name} 时长不合规`,
            actual: `${asset.duration.toFixed(2)} 秒`,
            allowed: `单段 ${limit.minSeconds}–${limit.maxSeconds} 秒`,
            solution: `裁剪或更换为 ${limit.minSeconds}–${limit.maxSeconds} 秒素材。`,
            assetId: asset.id,
          });
        if (willTrimAudio)
          add({
            code: "audio-auto-trim",
            title: `${asset.name} 将自动截取前 14 秒`,
            actual: `${asset.duration!.toFixed(2)} 秒`,
            allowed: "Wan 3.0 单段参考音频最长 15 秒",
            solution: "提交前会生成独立缓存文件，原音频不会被修改。",
            assetId: asset.id,
            severity: "warning",
          });
      }
      if (kind === "video" && (!asset.fps || asset.fps < (limit.minFPS ?? 0)))
        add({
          code: "video-fps",
          title: `${asset.name} 帧率不合规`,
          actual: asset.fps ? `${asset.fps.toFixed(2)} fps` : "帧率未知",
          allowed: `不低于 ${limit.minFPS} fps`,
          solution: `重新导出为至少 ${limit.minFPS} fps 的 MP4 或 MOV。`,
          assetId: asset.id,
        });
      if (kind === "image" && asset.hasAlpha)
        add({
          code: "image-alpha",
          title: `${asset.name} 包含透明通道`,
          actual: "检测到 Alpha 透明通道",
          allowed: "Wan 3.0 图片必须为不透明图像",
          solution: "将透明区域铺底后重新导出。",
          assetId: asset.id,
        });
      if (asset.missing || asset.unavailableAt)
        add({
          code: `${kind}-missing`,
          title: `${asset.name} 原始文件不可用`,
          actual: asset.managedPath || asset.originalPath || "路径未知",
          allowed: "提交前文件必须真实存在并可读取",
          solution: "在隐藏资产中重新定位文件，或重新连接移动硬盘/网络路径。",
          assetId: asset.id,
        });
    }
  }

  if (videoSeconds > 15)
    add({
      code: "video-total",
      title: "参考视频总时长超限",
      actual: `${videoSeconds.toFixed(2)} 秒`,
      allowed: "合计不超过 15 秒",
      solution: `至少缩短 ${(videoSeconds - 15).toFixed(2)} 秒，或移除部分参考视频。`,
    });
  if (audioSeconds > 15)
    add({
      code: "audio-total",
      title: "参考音频总时长超限",
      actual: `${audioSeconds.toFixed(2)} 秒`,
      allowed: "合计不超过 15 秒；与参考视频额度分别计算",
      solution: `至少缩短 ${(audioSeconds - 15).toFixed(2)} 秒，或移除部分参考音频。`,
    });
  if (smartDuration)
    add({
      code: "smart-duration",
      title: "智能时长将在云端决定",
      actual: "duration=-1",
      allowed: "模型根据 Prompt 与素材决定实际输出时长",
      solution: "可以提交；最终时长无法在提交前确定。",
      severity: "warning",
    });
  else if (!Number.isInteger(outputSeconds) || outputSeconds < 2 || outputSeconds > 30)
    add({
      code: "output-duration",
      title: "计划输出时长不合法",
      actual: Number.isFinite(outputSeconds) ? `${outputSeconds} 秒` : "未选择",
      allowed: "无视频输入时为 2–30 秒整数；或使用 -1 智能时长",
      solution: "选择合法输出时长后提交。",
    });
  else if (video.length && videoSeconds + outputSeconds > 30)
    add({
      code: "input-output-total",
      title: "参考视频与输出时长合计超限",
      actual: `参考视频 ${videoSeconds.toFixed(2)} 秒 + 输出 ${outputSeconds} 秒 = ${(videoSeconds + outputSeconds).toFixed(2)} 秒`,
      allowed: "合计不超过 30 秒",
      solution: `将输出时长调整至 ${Math.max(2, Math.floor(30 - videoSeconds))} 秒以内，或缩短参考视频。`,
    });

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
    videoSeconds,
    audioSeconds,
    outputSeconds,
    smartDuration,
  };
}

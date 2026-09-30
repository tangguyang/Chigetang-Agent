import { validDuration } from "./duration.ts";
import type {
  Asset,
  AssetBinding,
  Draft,
  Mention,
  Model,
  Parameter,
} from "./types.ts";

function extension(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function roleKind(role: AssetBinding["role"]): Asset["kind"] {
  if (role.includes("video")) return "video";
  if (role.includes("audio")) return "audio";
  return "image";
}

function validParameter(parameter: Parameter, value: unknown) {
  if (parameter.type === "boolean") return typeof value === "boolean";
  if (parameter.type === "select")
    return parameter.options?.includes(String(value)) ?? false;
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= (parameter.min ?? -Infinity) &&
    value <= (parameter.max ?? Infinity)
  );
}

export function isAssetCompatibleWithModel(
  asset: Asset | undefined,
  binding: AssetBinding,
  model: Model,
) {
  return assetCompatibilityReason(asset, binding, model) === null;
}

export function assetCompatibilityReason(
  asset: Asset | undefined,
  binding: AssetBinding,
  model: Model,
): string | null {
  if (!model.capabilities.roles.includes(binding.role))
    return "当前模型不支持该素材槽位";
  if (!asset) return null;
  if (asset.kind !== roleKind(binding.role)) return "素材类型与槽位不一致";
  const limit = model.capabilities.limits[asset.kind];
  if (!limit) return "当前模型不支持此类素材";
  const willTrimAudio =
    model.adapter === "wan3" &&
    binding.role === "reference_audio" &&
    Number(asset.duration || 0) > 14;
  if (
    !limit.extensions.includes(
      extension(asset.managedPath || asset.originalPath) ||
        extension(asset.name),
    )
  )
    return `格式不支持，可用：${limit.extensions.join(" / ")}`;
  if (!willTrimAudio && asset.size > limit.maxMB * 1024 * 1024)
    return `文件大小超过 ${limit.maxMB} MB`;
  if (
    asset.width &&
    asset.height &&
    (Math.min(asset.width, asset.height) < (limit.minSide ?? 0) ||
      Math.max(asset.width, asset.height) > (limit.maxSide ?? Infinity) ||
      Math.max(asset.width / asset.height, asset.height / asset.width) >
        (limit.maxRatio ?? Infinity))
  )
    return "分辨率或长宽比不符合当前模型";
  if (
    asset.duration &&
    (asset.duration < (limit.minSeconds ?? 0) ||
      (!willTrimAudio && asset.duration > (limit.maxSeconds ?? Infinity)))
  )
    return `时长 ${asset.duration.toFixed(2)} 秒，当前模型允许 ${limit.minSeconds ?? 0}–${limit.maxSeconds} 秒`;
  if (limit.minFPS && asset.fps && asset.fps < limit.minFPS)
    return `帧率低于 ${limit.minFPS} fps`;
  if (model.adapter === "wan3" && asset.hasAlpha) return "Wan 不支持透明通道";
  if (
    model.adapter === "seedance" &&
    asset.kind === "video" &&
    !asset.remoteUrl
  )
    return "参考视频需要官方可访问 URL";
  return null;
}

/** Remove only bound tokens belonging to explicitly removed materials. */
export function retainDraftAssets(
  draft: Draft,
  keptAssets: AssetBinding[],
): Draft {
  const keptBindings = new Set(keptAssets.map((binding) => binding.bindingId));
  const allMentions = [...(draft.mentions ?? [])].sort(
    (a, b) => a.start - b.start,
  );
  const counts: Record<string, number> = {};
  const labels = new Map(
    keptAssets.map((binding) => {
      const prefix =
        binding.role === "first_frame"
          ? "FirstFrame"
          : binding.role === "last_frame"
            ? "LastFrame"
            : binding.role === "reference_video"
              ? "Video"
              : binding.role === "reference_audio"
                ? "Audio"
                : "Image";
      return [
        binding.bindingId,
        prefix + (counts[prefix] = (counts[prefix] ?? 0) + 1),
      ];
    }),
  );
  let cursor = 0;
  let prompt = "";
  const mentions: Mention[] = [];
  for (const mention of allMentions) {
    prompt += draft.prompt.slice(cursor, mention.start);
    const label = labels.get(mention.bindingId);
    if (keptBindings.has(mention.bindingId) && label) {
      const start = prompt.length;
      prompt += "@" + label;
      mentions.push({ ...mention, label, start, end: prompt.length });
    }
    cursor = mention.end;
  }
  prompt += draft.prompt.slice(cursor);
  return { ...draft, assets: keptAssets, prompt, mentions };
}

export function migrateDraftToModel(
  draft: Draft,
  currentModel: Model,
  nextModel: Model,
  assets: Asset[],
) {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const keptAssets = draft.assets.filter((binding) => {
    const asset = assetMap.get(binding.assetId);
    return (
      nextModel.capabilities.roles.includes(binding.role) &&
      (!asset || asset.kind === roleKind(binding.role))
    );
  });
  const { prompt, mentions } = retainDraftAssets(draft, keptAssets);
  const params = Object.fromEntries(
    nextModel.capabilities.parameters.map((parameter) => {
      const current = draft.params[parameter.key];
      return [
        parameter.key,
        validParameter(parameter, current) ? current : parameter.default,
      ];
    }),
  );
  if (!validDuration(nextModel, { ...params, duration: draft.params.duration }))
    params.duration = 0;
  const nextDraft: Draft = {
    ...draft,
    modelId: nextModel.id,
    accountId:
      currentModel.providerId === nextModel.providerId
        ? draft.accountId
        : "auto",
    params,
    prompt,
    assets: keptAssets,
    mentions,
  };
  return {
    draft: nextDraft,
    kept: keptAssets.length,
    removed: draft.assets.length - keptAssets.length,
  };
}

export function replacePromptFromTemplate(
  draft: Draft,
  content: string,
): Draft {
  return { ...draft, prompt: content, mentions: [] };
}

export function assignImportedAssets(
  existing: AssetBinding[],
  imported: Asset[],
  roles: AssetBinding["role"][],
  frameMode: boolean,
) {
  const usedIds = new Set(existing.map((binding) => binding.assetId));
  const usedRoles = new Set(existing.map((binding) => binding.role));
  const additions: AssetBinding[] = [];
  for (const asset of imported) {
    if (usedIds.has(asset.id)) continue;
    let role: AssetBinding["role"] | null = null;
    if (frameMode && asset.kind === "image") {
      if (roles.includes("first_frame") && !usedRoles.has("first_frame"))
        role = "first_frame";
      else if (roles.includes("last_frame") && !usedRoles.has("last_frame"))
        role = "last_frame";
    } else {
      const desired =
        asset.kind === "video"
          ? "reference_video"
          : asset.kind === "audio"
            ? "reference_audio"
            : "reference_image";
      if (roles.includes(desired)) role = desired;
    }
    if (!role) continue;
    usedIds.add(asset.id);
    usedRoles.add(role);
    additions.push({
      assetId: asset.id,
      role,
      userRole: asset.defaultUsage || "其他",
      bindingId: crypto.randomUUID(),
    });
  }
  return additions;
}

/** Import completion must merge into the current draft, never a captured copy. */
export function mergeImportedAssets(
  started: Pick<Draft, "draftId" | "modelId">,
  current: Draft | null,
  imported: Asset[],
  roles: AssetBinding["role"][],
  frameMode: boolean,
): Draft | null {
  if (
    !current ||
    current.draftId !== started.draftId ||
    current.modelId !== started.modelId
  )
    return null;
  const additions = assignImportedAssets(
    current.assets,
    imported,
    roles,
    frameMode,
  );
  return { ...current, assets: [...current.assets, ...additions] };
}

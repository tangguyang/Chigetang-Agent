import type { Asset, Model, Params } from "./types.ts";
export function durationOptions(
  model: Model,
  params: Params = {},
  assets: Asset[] = [],
): number[] {
  const p = model.capabilities.parameters.find((p) => p.key === "duration");
  if (!p) return [];
  if (model.id === "seedance25" && params.omni_reference_task_type === "edit")
    return [-1];
  if (p.options)
    return p.options.map(Number).filter((v) => Number.isInteger(v) && v !== 0);
  const min = Math.max(
    model.adapter === "wan3" ? 2 : model.adapter === "seedance" ? 4 : 1,
    p.min ?? 1,
  );
  const referenceVideoSeconds = assets
    .filter((asset) => asset.kind === "video")
    .reduce((sum, asset) => sum + (asset.duration ?? 0), 0);
  const jointMax = model.capabilities.inputOutputDurationLimit;
  const max = Math.min(
    300,
    p.max ?? 30,
    jointMax && referenceVideoSeconds
      ? Math.floor(jointMax - referenceVideoSeconds)
      : Infinity,
  );
  return [
    ...((p.min ?? 0) <= -1 ? [-1] : []),
    ...Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i),
  ];
}
export function validDuration(
  model: Model,
  params: Params,
  assets: Asset[] = [],
) {
  return (
    typeof params.duration === "number" &&
    durationOptions(model, params, assets).includes(params.duration)
  );
}

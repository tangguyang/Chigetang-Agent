import type { Cost, Json, Snapshot } from "../../shared/types.ts";
export { estimateCost } from "../../shared/pricing.ts";
export function finalCost(s: Snapshot, raw: Json): Cost {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const usage =
    obj.usage && typeof obj.usage === "object" && !Array.isArray(obj.usage)
      ? obj.usage
      : {};
  if (s.price.rate === null) return s.estimatedCost;
  let quantity: number | null = null;
  if (s.price.unit === "million_tokens") {
    const tokens = usage.total_tokens ?? usage.completion_tokens;
    if (typeof tokens === "number") quantity = tokens / 1e6;
  } else {
    const output = usage.output_video_duration ?? usage.duration;
    const input = usage.input_video_duration;
    if (typeof output === "number")
      quantity =
        output +
        (s.price.basis === "input_output"
          ? typeof input === "number"
            ? input
            : s.assets
                .filter((a) => a.kind === "video")
                .reduce((n, a) => n + (a.duration ?? 0), 0)
          : 0);
  }
  return quantity === null
    ? s.estimatedCost
    : {
        amount: Math.round(quantity * s.price.rate * 1e4) / 1e4,
        currency: s.price.currency,
        kind: "estimate",
        note: "按 Provider 返回用量与历史价格估算，非实际账单",
      };
}

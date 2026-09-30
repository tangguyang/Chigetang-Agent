import type {
  Account,
  Model,
  Asset,
  Cost,
  Draft,
  Price,
  PricingRule,
  Snapshot,
} from "./types.ts";
export function selectPrice(
  price: Price,
  draft: Draft,
  assets: Asset[],
  region?: string,
): Price & { tokensPerSecond?: number } {
  if (!price.rules?.length) return price;
  const inputType = assets.some((a) => a.kind === "video")
    ? "video"
    : assets.some((a) => a.kind === "image")
      ? "image"
      : "text";
  const duration = Number(draft.params.duration);
  const audio = Boolean(draft.params.audio ?? draft.params.generate_audio);
  const eligible = price.rules.filter(
    (r) =>
      (!r.resolution ||
        r.resolution.toLowerCase() ===
          String(draft.params.resolution).toLowerCase()) &&
      (!r.region || r.region === region) &&
      (!r.inputType || r.inputType === inputType) &&
      (r.audio === undefined || r.audio === audio) &&
      (r.minDuration === undefined || duration >= r.minDuration) &&
      (r.maxDuration === undefined || duration <= r.maxDuration),
  );
  const score = (r: PricingRule) =>
    [
      "resolution",
      "region",
      "inputType",
      "audio",
      "minDuration",
      "maxDuration",
    ].reduce(
      (n, k) =>
        n +
        (r[k as keyof PricingRule] !== undefined &&
        r[k as keyof PricingRule] !== ""
          ? 1
          : 0),
      0,
    );
  eligible.sort((a, b) => score(b) - score(a));
  const rule = eligible[0];
  return rule
    ? { ...price, ...rule, source: `${price.source} · 规则 ${rule.id}` }
    : {
        ...price,
        rate: null,
        source: "没有匹配当前地域/分辨率/输入类型的价格规则",
      };
}
export function estimateCost(
  s: Pick<Snapshot, "price" | "draft" | "assets"> & { region?: string },
): Cost {
  const p = selectPrice(s.price, s.draft, s.assets, s.region);
  const unknown = (note: string): Cost => ({
    amount: null,
    currency: p.currency,
    kind: "unknown",
    note,
  });
  if (p.rate === null)
    return unknown(
      p.rules?.length ? p.source : "价格未配置，请在模型价格表配置适用单价",
    );
  const output = Number(s.draft.params.duration);
  if (!Number.isFinite(output) || output <= 0)
    return unknown(output === 0 ? "请选择时长" : "智能时长无法提前准确估算");
  if (
    p.basis === "input_output" &&
    s.assets.some(
      (a) =>
        a.kind === "video" &&
        (!Number.isFinite(a.duration) || a.duration! <= 0),
    )
  )
    return unknown("参考视频真实时长尚未读取，无法估算");
  const seconds =
    output +
    (p.basis === "input_output"
      ? s.assets
          .filter((a) => a.kind === "video")
          .reduce((n, a) => n + (a.duration ?? 0), 0)
      : 0);
  if (p.unit === "million_tokens" && !p.tokensPerSecond)
    return unknown(
      "按 tokens 计费：需配置适用的每秒预计 tokens，或等待云端用量",
    );
  const units =
    p.unit === "second" ? seconds : (seconds * p.tokensPerSecond!) / 1e6;
  return {
    amount: Math.round(units * p.rate * 1e4) / 1e4,
    currency: p.currency,
    kind: "estimate",
    note: `预计费用 · ${p.source}；实际费用以官方账单为准`,
  };
}
export function validatePrice(p: Price) {
  if (
    !["CNY", "USD"].includes(p.currency) ||
    !["second", "million_tokens"].includes(p.unit)
  )
    throw new Error("计费币种或单位无效");
  if (p.rate !== null && (!Number.isFinite(p.rate) || p.rate < 0))
    throw new Error("价格必须为非负数");
  for (const r of p.rules ?? []) {
    if (
      !r.id ||
      !Number.isFinite(r.rate) ||
      r.rate < 0 ||
      !["second", "million_tokens"].includes(r.unit)
    )
      throw new Error("价格规则无效");
    if (
      r.tokensPerSecond !== undefined &&
      (!Number.isFinite(r.tokensPerSecond) || r.tokensPerSecond <= 0)
    )
      throw new Error("每秒预计 tokens 必须为正数");
    if (
      r.minDuration !== undefined &&
      r.maxDuration !== undefined &&
      r.minDuration > r.maxDuration
    )
      throw new Error("价格规则时长范围无效");
  }
}

export function accountPrice(model: Model, account?: Account): Price {
  return account?.modelPrices?.[model.id] ?? model.price;
}
export function requestedWanPrice(): Price {
  return {
    currency: "CNY",
    unit: "second",
    rate: 0.6,
    basis: "input_output",
    source: "本账户约定价（用户指定，非统一官方价格）",
    updatedAt: "2026-09-16",
  };
}
export function costBreakdown(
  s: Pick<Snapshot, "price" | "draft" | "assets"> & { region?: string },
) {
  const p = selectPrice(s.price, s.draft, s.assets, s.region);
  const videos = s.assets.filter((a) => a.kind === "video");
  const referenceSeconds = videos.reduce((n, a) => n + (a.duration ?? 0), 0);
  const outputSeconds = Number(s.draft.params.duration);
  const known = videos.every(
    (a) => Number.isFinite(a.duration) && a.duration! > 0,
  );
  const factor =
    p.rate === null
      ? null
      : p.unit === "second"
        ? p.rate
        : p.tokensPerSecond
          ? (p.rate * p.tokensPerSecond) / 1e6
          : null;
  return {
    referenceSeconds,
    outputSeconds,
    referenceAmount:
      p.basis !== "input_output"
        ? 0
        : known && factor !== null
          ? referenceSeconds * factor
          : null,
    outputAmount:
      outputSeconds > 0 && factor !== null ? outputSeconds * factor : null,
  };
}

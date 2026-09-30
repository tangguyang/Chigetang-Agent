import type { Model, Price, PricingRule } from "../../shared/types.ts";
import { Field } from "./common.tsx";
export function PricingRules({
  model,
  value,
  onChange,
}: {
  model: Model;
  value: Price;
  onChange: (p: Price) => void;
}) {
  const rules = value.rules ?? [];
  function patch(id: string, p: Partial<PricingRule>) {
    onChange({
      ...value,
      rules: rules.map((r) => (r.id === id ? { ...r, ...p } : r)),
    });
  }
  return (
    <details className="pricing-rules">
      <summary>分条件价格表（{rules.length} 条）</summary>
      <p className="muted">
        配置价格表后优先匹配地域、分辨率、输入类型和声音；无匹配规则显示未知。单价请按官方账户当前报价填写。
      </p>
      {rules.map((r) => (
        <div className="price-rule" key={r.id}>
          <div className="form-grid">
            <Field label="分辨率">
              <select
                value={r.resolution ?? ""}
                onChange={(e) =>
                  patch(r.id, { resolution: e.target.value || undefined })
                }
              >
                <option value="">全部</option>
                {model.capabilities.parameters
                  .find((p) => p.key === "resolution")
                  ?.options?.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
              </select>
            </Field>
            <Field label="输入类型">
              <select
                value={r.inputType ?? ""}
                onChange={(e) =>
                  patch(r.id, {
                    inputType: (e.target.value ||
                      undefined) as PricingRule["inputType"],
                  })
                }
              >
                <option value="">全部</option>
                <option value="text">仅文字</option>
                <option value="image">含图片</option>
                <option value="video">含视频</option>
              </select>
            </Field>
            <Field label="Region（空为全部）">
              <input
                value={r.region ?? ""}
                onChange={(e) =>
                  patch(r.id, { region: e.target.value.trim() || undefined })
                }
              />
            </Field>
            <Field label="声音">
              <select
                value={r.audio === undefined ? "" : String(r.audio)}
                onChange={(e) =>
                  patch(r.id, {
                    audio:
                      e.target.value === ""
                        ? undefined
                        : e.target.value === "true",
                  })
                }
              >
                <option value="">全部</option>
                <option value="true">开启</option>
                <option value="false">关闭</option>
              </select>
            </Field>
            <Field label="计费单位">
              <select
                value={r.unit}
                onChange={(e) =>
                  patch(r.id, { unit: e.target.value as PricingRule["unit"] })
                }
              >
                <option value="second">每秒</option>
                <option value="million_tokens">每百万 tokens</option>
              </select>
            </Field>
            <Field label="单价">
              <input
                type="number"
                min={0}
                step="0.0001"
                value={Number.isFinite(r.rate) ? r.rate : ""}
                onChange={(e) =>
                  patch(r.id, {
                    rate: e.target.value === "" ? NaN : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="计费时长">
              <select
                value={r.basis ?? "output"}
                onChange={(e) =>
                  patch(r.id, { basis: e.target.value as PricingRule["basis"] })
                }
              >
                <option value="output">仅输出</option>
                <option value="input_output">输入视频 + 输出</option>
              </select>
            </Field>
            {r.unit === "million_tokens" && (
              <Field label="每秒预计 tokens（可选）">
                <input
                  type="number"
                  min={1}
                  value={r.tokensPerSecond ?? ""}
                  onChange={(e) =>
                    patch(r.id, {
                      tokensPerSecond: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                />
              </Field>
            )}
            <Field label="最小时长（可选）">
              <input
                type="number"
                min={1}
                value={r.minDuration ?? ""}
                onChange={(e) =>
                  patch(r.id, {
                    minDuration: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
              />
            </Field>
            <Field label="最大时长（可选）">
              <input
                type="number"
                min={1}
                value={r.maxDuration ?? ""}
                onChange={(e) =>
                  patch(r.id, {
                    maxDuration: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
              />
            </Field>
          </div>
          <button
            className="danger"
            onClick={() =>
              onChange({ ...value, rules: rules.filter((v) => v.id !== r.id) })
            }
          >
            移除此规则
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange({
            ...value,
            rules: [
              ...rules,
              {
                id: crypto.randomUUID().slice(0, 8),
                rate: NaN,
                unit: value.unit,
                basis: value.basis,
              },
            ],
          })
        }
      >
        ＋ 添加价格规则
      </button>
    </details>
  );
}

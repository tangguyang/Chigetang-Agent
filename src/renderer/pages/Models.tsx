import { requestedWanPrice } from "../../shared/pricing.ts";
import { Copy, Eye, KeyRound, Plus, ShieldCheck, Star } from "lucide-react";
import { useState } from "react";
import type { Account, ConnectionResult, Model } from "../../shared/types.ts";
import { Empty, Field, Modal } from "../components/common.tsx";
import { PricingRules } from "../components/PricingRules.tsx";
import { api, run, useApp } from "../store.ts";
import { StatisticsPage } from "./Statistics.tsx";
export function ModelsPage({ initialTab = "accounts" }: { initialTab?: string }) {
  const { boot, refresh } = useApp();
  const [tab, setTab] = useState(initialTab),
    [edit, setEdit] = useState<(Partial<Account> & { key?: string }) | null>(
      null,
    ),
    [price, setPrice] = useState<Model | null>(null),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [caps, setCaps] = useState<Model | null>(null);
  const [testing, setTesting] = useState<string | null>(null),
    [connection, setConnection] = useState<ConnectionResult | null>(null);
  async function test(id: string) {
    setTesting(id);
    try {
      await run(async () =>
        setConnection(
          await api<ConnectionResult>("accounts.test", {
            id,
            modelId: useApp.getState().draft?.modelId,
          }),
        ),
      );
    } finally {
      setTesting(null);
    }
  }
  if (!boot) return null;
  async function save() {
    setBusy(true);
    await run(async () => {
      await api("accounts.save", edit);
      setEdit(null);
      setShow(false);
      await refresh();
    }, "账户已加密保存");
    setBusy(false);
  }
  return (
    <section>
      <div className="page-title">
        <div>
          <h1>模型与 API</h1>
          <p>模型可以更换，你的创作方式始终如一。</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setEdit({
              name: "",
              providerId: "alibaba",
              workspaceId: "",
              region: "cn-beijing",
              key: "",
              enabled: true,
              isDefault: false,
              maxConcurrent: 2,
            });
            setShow(false);
          }}
        >
          <Plus size={17} />
          添加 API 账户
        </button>
      </div>
      <div className="tabs">
        {[
          ["accounts", "API 账户"],
          ["models", "模型"],
          ["providers", "Providers"],
          ["statistics", "统计"],
        ].map(([k, v]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {v}
          </button>
        ))}
      </div>
      {tab === "accounts" && (
        <>
          {!boot.accounts.length ? (
            <Empty
              title="连接你的第一个模型账户"
              description="API Key 只在本机加密保存。请直接在这里输入，无需发送到聊天。"
            />
          ) : (
            <div className="account-list">
              {boot.accounts.map((a) => (
                <article className="account-row" key={a.id}>
                  <div className="provider-icon">
                    <KeyRound size={22} />
                  </div>
                  <div>
                    <h3>
                      {a.name}{" "}
                      {a.isDefault && <span className="pill">默认</span>}
                    </h3>
                    <p>
                      {boot.providers.find((p) => p.id === a.providerId)?.name}{" "}
                      · {a.region} · {a.maskedKey}
                    </p>
                    <small>该Provider暂不支持API余额实时查询</small>
                    {a.manualBalance && (
                      <small>手动备注：{a.manualBalance}</small>
                    )}
                  </div>
                  <span className={a.enabled ? "live" : "muted"}>
                    {a.enabled ? "已启用" : "停用"}
                  </span>
                  <button
                    onClick={() => {
                      setEdit(a);
                      setShow(false);
                    }}
                  >
                    管理账户
                  </button>
                  <button
                    disabled={testing !== null}
                    onClick={() => void test(a.id)}
                  >
                    {testing === a.id ? "测试中…" : "测试连接"}
                  </button>
                </article>
              ))}
            </div>
          )}
          <div className="security-note">
            <ShieldCheck size={22} />
            <div>
              <strong>密钥由 Windows 系统保护</strong>
              <p>
                通过 DPAPI
                加密，绑定当前电脑与用户。迁移到另一台电脑时，重新输入 Key
                即可。
              </p>
            </div>
          </div>
        </>
      )}
      {tab === "models" && (
        <div className="model-list">
          {boot.models.map((m) => (
            <article className="model-row" key={m.id}>
              <div className="model-monogram">
                {m.adapter === "wan3" ? "W" : "S"}
              </div>
              <div>
                <h3>{m.name}</h3>
                <p>{m.officialId}</p>
                <small>{m.note}</small>
                <small>
                  {m.price.rules?.length
                    ? `已配置 ${m.price.rules.length} 条价格规则`
                    : m.price.rate === null
                      ? "尚未配置价格"
                      : `${m.price.currency} ${m.price.rate} / ${m.price.unit === "second" ? "秒" : "百万 tokens"} · 手动配置`}
                </small>
              </div>
              <button
                className={m.favorite ? "accent" : ""}
                title="收藏模型"
                onClick={() =>
                  void run(async () => {
                    await api("models.save", {
                      id: m.id,
                      favorite: !m.favorite,
                    });
                    await refresh();
                  })
                }
              >
                <Star size={18} fill={m.favorite ? "currentColor" : "none"} />
              </button>
              <button onClick={() => setCaps(m)}>能力</button>
              <button onClick={() => setPrice(m)}>配置</button>
            </article>
          ))}
        </div>
      )}
      {tab === "providers" &&
        boot.providers.map((p) => (
          <article className="provider-row" key={p.id}>
            <h3>{p.name}</h3>
            <p className="path">{p.endpoint}</p>
            <p>
              地域 {p.region} · 默认并发 {p.maxConcurrent}
            </p>
            <small>官方文档：{p.docs}</small>
          </article>
        ))}
      {tab === "statistics" && <StatisticsPage />}
      {edit && (
        <Modal
          title={edit.id ? "管理 API 账户" : "添加 API 账户"}
          onClose={() => {
            setEdit(null);
            setShow(false);
          }}
        >
          <div className="form-grid">
            <Field label="账户名称">
              <input
                autoFocus
                value={edit.name ?? ""}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                placeholder="例如：百炼账号 A"
              />
            </Field>
            <Field label="Provider">
              <select
                value={edit.providerId}
                onChange={(e) =>
                  setEdit({ ...edit, providerId: e.target.value, endpoint: "" })
                }
              >
                {boot.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="API Key"
            hint={edit.id ? "留空表示保留原 Key。" : "不会写入明文配置或日志。"}
          >
            <div className="secret-input">
              <input
                type={show ? "text" : "password"}
                autoComplete="off"
                value={edit.key ?? ""}
                placeholder={edit.maskedKey || "输入 API Key"}
                onChange={(e) => setEdit({ ...edit, key: e.target.value })}
              />
              <button
                title="临时显示"
                onClick={() => {
                  if (!show && edit.id && !edit.key)
                    void run(async () =>
                      setEdit({
                        ...edit,
                        key: await api<string>("accounts.reveal", {
                          id: edit.id,
                        }),
                      }),
                    );
                  setShow(!show);
                  setTimeout(() => setShow(false), 15000);
                }}
              >
                <Eye size={16} />
              </button>
              <button
                title="复制 Key"
                onClick={() =>
                  void run(async () => {
                    const key =
                      edit.key ||
                      (edit.id
                        ? await api<string>("accounts.reveal", { id: edit.id })
                        : "");
                    await navigator.clipboard.writeText(key);
                  }, "Key 已复制到剪贴板")
                }
              >
                <Copy size={16} />
              </button>
            </div>
          </Field>
          <div className="form-grid">
            {edit.providerId === "alibaba" && (
              <Field label="Workspace ID（业务空间 ID）">
                <input
                  value={edit.workspaceId ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, workspaceId: e.target.value })
                  }
                />
              </Field>
            )}
            <Field label="地域">
              <select
                value={edit.region ?? "cn-beijing"}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    region: e.target.value,
                    endpoint:
                      edit.providerId === "alibaba"
                        ? `https://{workspace}.${e.target.value}.maas.aliyuncs.com`
                        : edit.endpoint,
                  })
                }
              >
                {(edit.providerId === "alibaba"
                  ? [
                      "cn-beijing",
                      "ap-southeast-1",
                      "ap-northeast-1",
                      "eu-central-1",
                      "us-east-1",
                      "cn-hongkong",
                    ]
                  : ["cn-beijing"]
                ).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="账户最大并发">
              <input
                type="number"
                min={1}
                max={10}
                value={edit.maxConcurrent ?? 2}
                onChange={(e) =>
                  setEdit({ ...edit, maxConcurrent: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <details>
            <summary>Endpoint 与备注</summary>
            <Field label="官方 Endpoint（留空使用默认）">
              <input
                value={edit.endpoint ?? ""}
                onChange={(e) => setEdit({ ...edit, endpoint: e.target.value })}
              />
            </Field>
            <Field label="套餐 / 余额 / 到期日（手动数据）">
              <input
                value={edit.manualBalance ?? ""}
                onChange={(e) =>
                  setEdit({ ...edit, manualBalance: e.target.value })
                }
              />
            </Field>
            {edit.providerId === "alibaba" && (
              <Field
                label="本账户 WAN 3.0 单价（元/秒）"
                hint="参考视频与生成视频均计费；仅影响新任务估算，不修改旧任务账目。"
              >
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label="WAN账户单价"
                  value={edit.modelPrices?.wan3?.rate ?? 0.6}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      modelPrices: {
                        ...edit.modelPrices,
                        wan3: {
                          ...requestedWanPrice(),
                          rate:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        },
                      },
                    })
                  }
                />
              </Field>
            )}
            <Field label="备注">
              <textarea
                value={edit.notes ?? ""}
                onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
              />
            </Field>
          </details>
          <div className="actions">
            <label className="check">
              <input
                type="checkbox"
                checked={edit.enabled ?? true}
                onChange={(e) =>
                  setEdit({ ...edit, enabled: e.target.checked })
                }
              />
              启用
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.isDefault ?? false}
                onChange={(e) =>
                  setEdit({ ...edit, isDefault: e.target.checked })
                }
              />
              默认账户
            </label>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "保存中…" : "加密保存"}
            </button>
          </div>
        </Modal>
      )}
      {price && (
        <Modal title={`${price.name} 配置`} onClose={() => setPrice(null)}>
          <Field label="显示名称">
            <input
              value={price.name}
              onChange={(e) => setPrice({ ...price, name: e.target.value })}
            />
          </Field>
          {price.audio && (
            <details open>
              <summary>音频模型连接配置</summary>
              <p>
                API Key 复用“API 账户”；音频 endpoint 独立于 Wan 视频 endpoint。
              </p>
              {Object.entries(price.audio.endpoints).map(([region, urls]) => (
                <div key={region}>
                  <strong>{region}</strong>
                  {(["tts", "clone"] as const).map((key) => (
                    <Field
                      key={key}
                      label={
                        key === "tts"
                          ? "语音合成 Endpoint"
                          : "声音复刻 Endpoint"
                      }
                    >
                      <input
                        value={urls[key]}
                        onChange={(e) =>
                          setPrice({
                            ...price,
                            audio: {
                              ...price.audio!,
                              endpoints: {
                                ...price.audio!.endpoints,
                                [region]: { ...urls, [key]: e.target.value },
                              },
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              ))}
              <p>
                支持的音色和指令能力由模型能力矩阵控制。更改模型 ID
                前请核对兼容性。
              </p>
            </details>
          )}
          <Field label="官方 Model ID">
            <input
              value={price.officialId}
              onChange={(e) =>
                setPrice({ ...price, officialId: e.target.value })
              }
            />
          </Field>
          <div className="form-grid">
            <Field label="计费货币">
              <select
                value={price.price.currency}
                onChange={(e) =>
                  setPrice({
                    ...price,
                    price: {
                      ...price.price,
                      currency: e.target.value as "CNY" | "USD",
                    },
                  })
                }
              >
                <option>CNY</option>
                <option>USD</option>
              </select>
            </Field>
            <Field
              label={
                price.price.unit === "second"
                  ? "每秒价格（留空表示未知）"
                  : "每百万 tokens 价格"
              }
            >
              <input
                type="number"
                step="0.0001"
                min="0"
                value={price.price.rate ?? ""}
                onChange={(e) =>
                  setPrice({
                    ...price,
                    price: {
                      ...price.price,
                      rate:
                        e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          </div>
          {price.type !== "audio" && price.price.unit === "second" && (
            <Field label="计费时长">
              <select
                value={price.price.basis ?? "output"}
                onChange={(e) =>
                  setPrice({
                    ...price,
                    price: {
                      ...price.price,
                      basis: e.target.value as "output" | "input_output",
                    },
                  })
                }
              >
                <option value="output">仅输出视频</option>
                <option value="input_output">输入 + 输出视频</option>
              </select>
            </Field>
          )}
          <Field label="价格来源 / 适用地域和分辨率">
            <input
              value={price.price.source}
              onChange={(e) =>
                setPrice({
                  ...price,
                  price: { ...price.price, source: e.target.value },
                })
              }
            />
          </Field>
          <p className="muted">
            这里的单价由你按当前账户配置，不能代表所有分辨率和地区。历史任务保持原价格快照。
          </p>
          {price.type !== "audio" && (
            <PricingRules
              model={price}
              value={price.price}
              onChange={(value) => setPrice({ ...price, price: value })}
            />
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={price.enabled}
              onChange={(e) =>
                setPrice({ ...price, enabled: e.target.checked })
              }
            />
            启用模型
          </label>
          {!price.verified && (
            <div className="notice warning">
              当前型号能力未完成官方复核。不要用真实费用验证未知参数。
            </div>
          )}
          <button
            className="primary"
            onClick={() =>
              void run(async () => {
                await api("models.save", {
                  ...price,
                  price: {
                    ...price.price,
                    updatedAt: new Date().toISOString(),
                  },
                });
                setPrice(null);
                await refresh();
              }, "模型配置已保存")
            }
          >
            保存配置
          </button>
        </Modal>
      )}
      {connection && (
        <Modal
          title="API 连接诊断（不生成视频）"
          onClose={() => setConnection(null)}
        >
          <p className={connection.ok ? "live" : "danger"}>
            {connection.ok ? "只读鉴权检查通过" : "检查未通过"}
          </p>
          <dl>
            <dt>账户</dt>
            <dd>{connection.accountName}</dd>
            <dt>API Key</dt>
            <dd>
              {connection.keyLoaded
                ? "已在本机解密读取（不显示原文）"
                : "尚未读取"}
            </dd>
            <dt>Workspace ID</dt>
            <dd>{connection.workspaceId || "未填写"}</dd>
            <dt>Region</dt>
            <dd>{connection.region}</dd>
            <dt>模型</dt>
            <dd>{connection.model}</dd>
            <dt>Endpoint</dt>
            <dd className="path">{connection.endpoint || "未构造"}</dd>
          </dl>
          {connection.checks.map((c) => (
            <p key={c}>✓ {c}</p>
          ))}
          {connection.error && (
            <pre className="api-error">{connection.error}</pre>
          )}
          <small>本测试不创建付费任务；不能代替真实视频生成验证。</small>
        </Modal>
      )}
      {caps && (
        <Modal title={`${caps.name} 能力`} onClose={() => setCaps(null)}>
          <p>{caps.note}</p>
          <dl>
            {Object.entries(caps.audio ?? caps.capabilities)
              .filter(([k]) => k.startsWith("supports"))
              .map(([k, v]) => (
                <div className="dl-row" key={k}>
                  <dt>{k.replace("supports", "")}</dt>
                  <dd>{v ? "支持" : "不支持"}</dd>
                </div>
              ))}
          </dl>
          <small>参数和素材槽位均由此能力定义生成。</small>
        </Modal>
      )}
    </section>
  );
}

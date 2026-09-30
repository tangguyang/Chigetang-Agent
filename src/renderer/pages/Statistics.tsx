import { useEffect, useState } from "react";
import type { Application } from "../../main/services/application.ts";
import { Pagination, Modal, Field } from "../components/common.tsx";
import { api, labels, run, time, useApp } from "../store.ts";
interface Total {
  effective: number | null;
  manualKnown: number;
  currency: string;
  tasks: number;
  estimated: number | null;
  actual: number | null;
  actualKnown: number;
  estimateUnknown: number;
  successEstimate: number | null;
  failedEstimate: number | null;
  successActual: number | null;
  failedActual: number | null;
}
interface Row {
  name: string;
  manual: number | null;
  manual_note: string | null;
  effective: number | null;
  effective_source: string;
  version_id: string;
  model: string;
  provider: string;
  account: string;
  submitted_at: string | null;
  created_at: string;
  duration: string | number;
  resolution: string;
  estimated: number | null;
  usage_estimated: number | null;
  actual: number | null;
  currency: string;
  status: string;
}
interface Billing {
  totals: Total[];
  tasks: Row[];
  total: number;
}
const format = (n: number | null, currency = "CNY") =>
  n === null ? "未知" : `${currency === "CNY" ? "¥" : "$"}${n.toFixed(2)}`;
export function dateRange(
  period: string,
  now = new Date(),
  from = "",
  to = "",
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (period === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (period === "month") start.setDate(1);
  else if (period === "7" || period === "30")
    start.setDate(start.getDate() - Number(period) + 1);
  else if (period === "custom") {
    return {
      from: from ? new Date(from + "T00:00:00").toISOString() : undefined,
      to: to ? new Date(to + "T23:59:59.999").toISOString() : undefined,
    };
  }
  return {
    from: start.toISOString(),
    to: new Date(end.getTime() - 1).toISOString(),
  };
}
export function StatisticsPage() {
  const [distribution, setDistribution] = useState<ReturnType<
    Application["statistics"]
  > | null>(null);
  const state = useApp();
  const [editing, setEditing] = useState<Row | null>(null),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState("");
  const [audit, setAudit] = useState<
    {
      id: number;
      created_at: string;
      before_data: string;
      after_data: string;
    }[]
  >([]);
  async function editCost(t: Row) {
    setEditing(t);
    setAmount(t.manual === null ? "" : String(t.manual));
    setNote(t.manual_note || "");
    setAudit(await api("billing.history", { id: t.version_id }));
  }
  async function correct(undo = false) {
    if (!editing) return;
    await api("billing.correct", {
      id: editing.version_id,
      amount: undo ? null : Number(amount),
      note,
    });
    setEditing(null);
    await refresh();
  }

  const [period, setPeriod] = useState("today"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [account, setAccount] = useState(""),
    [page, setPage] = useState(1),
    [report, setReport] = useState<Billing | null>(null),
    [summary, setSummary] = useState<Record<string, Billing>>({}),
    [balance, setBalance] = useState("该Provider暂不支持API余额实时查询"),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      const result = await api<Billing>("billing.report", {
        ...dateRange(period, new Date(), from, to),
        accountId: account || undefined,
        page,
      });
      setReport(result);
      setDistribution(
        await api("statistics", dateRange(period, new Date(), from, to)),
      );
      const entries = await Promise.all(
        ["today", "yesterday", "month"].map(
          async (p) =>
            [
              p,
              await api<Billing>("billing.report", {
                ...dateRange(p),
                accountId: account || undefined,
              }),
            ] as const,
        ),
      );
      setSummary(Object.fromEntries(entries));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(refresh);
  }, [period, from, to, account, page]);
  useEffect(
    () => window.aiVideo.onChange(() => void run(refresh)),
    [period, from, to, account, page],
  );
  return (
    <section className="list-page">
      <div className="list-scroll">
        <div className="page-title">
          <div>
            <h1>统计</h1>
            <p>费用与消耗中心 · 预计消耗与实际扣费分开记录。</p>
          </div>
          <button disabled={busy} onClick={() => void run(refresh)}>
            {busy ? "刷新中…" : "刷新统计"}
          </button>
        </div>
        <div className="filters">
          <select
            aria-label="费用账户"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setPage(1);
              setBalance("该Provider暂不支持API余额实时查询");
            }}
          >
            <option value="">全部 API 账户</option>
            {state.boot?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            aria-label="费用日期"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              setPage(1);
            }}
          >
            <option value="today">今日</option>
            <option value="yesterday">昨日</option>
            <option value="month">本月</option>
            <option value="7">近7天</option>
            <option value="30">近30天</option>
            <option value="custom">自定义</option>
          </select>
          {period === "custom" && (
            <>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          )}
        </div>
        <div className="balance-notice">
          <span>账户余额：{balance}</span>
          {account && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setBusy(true);
                  try {
                    setBalance(
                      (
                        await api<{ supported: boolean; message: string }>(
                          "accounts.balance",
                          { id: account },
                        )
                      ).message,
                    );
                  } finally {
                    setBusy(false);
                  }
                })
              }
            >
              查询能力
            </button>
          )}
        </div>
        <div className="stats-grid">
          {[
            ["today", "今日账目合计"],
            ["yesterday", "昨日账目合计"],
            ["month", "本月账目合计"],
          ].map(([key, label]) => (
            <div className="stat" key={key}>
              <span>{label}</span>
              <strong>
                {summary[key]?.totals.length
                  ? summary[key].totals
                      .map((t) => format(t.effective, t.currency))
                      .join(" / ")
                  : "—"}
              </strong>
              <small>{summary[key]?.total ?? 0} 个任务</small>
            </div>
          ))}
          <div className="stat">
            <span>所选范围任务数</span>
            <strong>{report?.total ?? 0}</strong>
            <small>含已隐藏记录，避免漏计费用</small>
          </div>
        </div>
        <section className="cost-summary">
          <h3>消耗明细</h3>
          {report?.totals.map((t) => (
            <div className="billing-totals" key={t.currency}>
              <strong>{format(t.effective, t.currency)}</strong>
              <span>账目合计（人工确认 → 接口实际 → 已提交估算）</span>
              <p>
                成功任务估算 {format(t.successEstimate, t.currency)} ·
                失败任务预算 {format(t.failedEstimate, t.currency)}
              </p>
              <p>
                实际扣费{" "}
                {t.actualKnown
                  ? format(t.actual, t.currency)
                  : "未取得官方账单"}{" "}
                · 成功实际 {format(t.successActual, t.currency)} · 失败实际{" "}
                {format(t.failedActual, t.currency)}
              </p>
              <small>
                人工确认 {t.manualKnown} 次 · 未知估算 {t.estimateUnknown}{" "}
                次。失败任务预算不表示已扣费；不同币种不合并。
              </small>
            </div>
          ))}
          {!report?.total && <p>尚无任务费用记录</p>}
          <small>
            预计费用来自可维护的价格表；本地统计不能替代 Provider
            账单。未配置价格不代表免费。
          </small>
        </section>
        <details>
          <summary>生产分布 · Provider / 模型 / API 账户</summary>
          <div className="stats-grid">
            {[
              [
                "Provider",
                distribution?.providers.map((r) => [
                  state.boot?.providers.find((p) => p.id === r.provider_id)
                    ?.name ?? r.provider_id,
                  r.count,
                ]),
              ],
              [
                "模型",
                distribution?.models.map((r) => [
                  state.boot?.models.find((m) => m.id === r.model_id)?.name ??
                    r.model_id,
                  r.count,
                ]),
              ],
              [
                "API 账户",
                distribution?.accounts.map((r) => [
                  state.boot?.accounts.find((a) => a.id === r.account_id)
                    ?.name ?? r.account_id,
                  r.count,
                ]),
              ],
              [
                "状态",
                distribution?.statuses.map((r) => [labels[r.status], r.count]),
              ],
            ].map(([title, rows]) => (
              <div key={String(title)}>
                <h4>{String(title)}</h4>
                {(rows as (string | number)[][] | undefined)?.map(
                  ([name, count]) => (
                    <p key={String(name)}>
                      {name}：{count} 次
                    </p>
                  ),
                )}
              </div>
            ))}
          </div>
          <small>生产分布按所选时间统计所有账户。</small>
        </details>
        <h3>逐任务 Usage / Billing</h3>
        <div className="billing-table">
          <table>
            <thead>
              <tr>
                <th>模型 / Provider</th>
                <th>账户 / 提交时间</th>
                <th>时长 / 分辨率</th>
                <th>预计费用</th>
                <th>用量估算</th>
                <th>接口实际费用</th>
                <th>采用金额 / 来源</th>
                <th>状态</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {report?.tasks.map((t) => (
                <tr key={t.version_id}>
                  <td>
                    {t.name}
                    <small>
                      {t.model} · {t.provider}
                    </small>
                  </td>
                  <td>
                    {t.account}
                    <small>
                      {t.submitted_at ? time(t.submitted_at) : "尚未提交"}
                    </small>
                  </td>
                  <td>
                    {Number(t.duration) < 0 ? "智能" : `${t.duration}秒`}
                    <small>{t.resolution}</small>
                  </td>
                  <td>{format(t.estimated, t.currency)}</td>
                  <td>{format(t.usage_estimated, t.currency)}</td>
                  <td>
                    {t.actual === null
                      ? "未取得账单"
                      : format(t.actual, t.currency)}
                  </td>
                  <td>
                    {format(t.effective, t.currency)}
                    <small>
                      {t.effective_source === "manual"
                        ? "人工确认"
                        : t.effective_source === "actual"
                          ? "接口实际"
                          : "估算"}
                    </small>
                  </td>
                  <td>{labels[t.status]}</td>
                  <td>
                    <button onClick={() => state.setTask(t.version_id)}>
                      查看
                    </button>
                    <button onClick={() => void run(() => editCost(t))}>
                      修正费用
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={page} total={report?.total ?? 0} onChange={setPage} />
      {editing && (
        <Modal
          title={`修正费用 · ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <p>
            仅修改软件账目，不改变服务商实际扣费；单价在 API 账户中单独设置。
          </p>
          <p>
            原估算 {format(editing.estimated, editing.currency)} · 接口实际{" "}
            {format(editing.actual, editing.currency)}
          </p>
          <Field label={`人工确认金额（${editing.currency}）`}>
            <input
              aria-label="人工确认金额"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="备注">
            <textarea
              aria-label="费用备注"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="actions">
            <button
              disabled={editing.manual === null}
              onClick={() => void run(() => correct(true))}
            >
              撤销人工修正
            </button>
            <button
              className="primary"
              disabled={
                !amount.trim() ||
                !Number.isFinite(Number(amount)) ||
                Number(amount) < 0
              }
              onClick={() => void run(() => correct())}
            >
              保存费用
            </button>
          </div>
          <h3>修改记录</h3>
          {audit.length ? (
            audit.map((a) => {
              const before = JSON.parse(a.before_data),
                after = JSON.parse(a.after_data);
              return (
                <p key={a.id}>
                  {time(a.created_at)} ·{" "}
                  {before
                    ? format(before.amount, editing.currency)
                    : "无人工修正"}{" "}
                  → {after ? format(after.amount, editing.currency) : "已撤销"}
                  <small>
                    修改前备注：{before?.note || "无"}；修改后备注：
                    {after?.note || "无"}
                  </small>
                </p>
              );
            })
          ) : (
            <p>暂无人工修改</p>
          )}
        </Modal>
      )}
    </section>
  );
}

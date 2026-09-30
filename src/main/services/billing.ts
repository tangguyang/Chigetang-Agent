import type { Task } from "../../shared/types.ts";
import type { Database } from "../database/db.ts";
export function recordBilling(db: Database, t: Task) {
  db.run(
    `INSERT INTO billing_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(version_id) DO UPDATE SET submitted_at=excluded.submitted_at,status=excluded.status,usage_estimated=excluded.usage_estimated,actual=COALESCE(excluded.actual,billing_records.actual),actual_source=COALESCE(excluded.actual_source,billing_records.actual_source),data=excluded.data`,
    t.id,
    t.snapshot.account.id,
    t.snapshot.provider.id,
    t.snapshot.model.id,
    t.createdAt,
    t.submittedAt,
    t.status,
    t.snapshot.estimatedCost.currency,
    t.snapshot.estimatedCost.amount,
    t.cost.kind === "estimate" ? t.cost.amount : null,
    t.actualCost?.kind === "actual"
      ? t.actualCost.amount
      : t.cost.kind === "actual"
        ? t.cost.amount
        : null,
    t.actualCost?.note ?? null,
    JSON.stringify({
      resolution: t.snapshot.draft.params.resolution,
      duration: t.snapshot.draft.params.duration,
      deletedAt: t.deletedAt,
    }),
  );
}
export class BillingManager {
  db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  correct(id: string, amount: number | null, note: string) {
    if (
      amount !== null &&
      (typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > 1e9)
    )
      throw new Error("实际金额必须为有效非负数");
    if (typeof note !== "string" || note.length > 2000)
      throw new Error("备注过长");
    this.db.transaction(() => {
      if (
        !this.db.one(
          "SELECT version_id FROM billing_records WHERE version_id=?",
          id,
        )
      )
        throw new Error("任务账目不存在");
      const before =
        this.db.one(
          "SELECT amount,note,updated_at FROM billing_manual WHERE version_id=?",
          id,
        ) ?? null;
      const after =
        amount === null
          ? null
          : { amount, note, updated_at: new Date().toISOString() };
      if (after)
        this.db.run(
          "INSERT INTO billing_manual VALUES(?,?,?,?) ON CONFLICT(version_id) DO UPDATE SET amount=excluded.amount,note=excluded.note,updated_at=excluded.updated_at",
          id,
          after.amount,
          after.note,
          after.updated_at,
        );
      else this.db.run("DELETE FROM billing_manual WHERE version_id=?", id);
      this.db.run(
        "INSERT INTO billing_audit(version_id,created_at,before_data,after_data) VALUES(?,?,?,?)",
        id,
        new Date().toISOString(),
        JSON.stringify(before),
        JSON.stringify(after),
      );
    });
  }
  history(id: string) {
    return this.db.all<{
      id: number;
      created_at: string;
      before_data: string;
      after_data: string;
    }>("SELECT * FROM billing_audit WHERE version_id=? ORDER BY id DESC", id);
  }
  report(
    q: { from?: string; to?: string; accountId?: string; page?: number } = {},
  ) {
    const clauses = ["1=1"],
      p: string[] = [];
    if (q.from) {
      clauses.push("COALESCE(b.submitted_at,b.created_at)>=?");
      p.push(q.from);
    }
    if (q.to) {
      clauses.push("COALESCE(b.submitted_at,b.created_at)<=?");
      p.push(q.to);
    }
    if (q.accountId) {
      clauses.push("b.account_id=?");
      p.push(q.accountId);
    }
    const where = clauses.join(" AND ");
    const source = `(SELECT b.*,m.amount manual,m.note manual_note,m.updated_at manual_updated_at,
      COALESCE(m.amount,b.actual,CASE WHEN b.submitted_at IS NOT NULL THEN COALESCE(b.usage_estimated,b.estimated) END) effective,
      CASE WHEN m.amount IS NOT NULL THEN 'manual' WHEN b.actual IS NOT NULL THEN 'actual' ELSE 'estimate' END effective_source
      FROM billing_records b JOIN task_versions v ON v.id=b.version_id
      LEFT JOIN billing_manual m ON m.version_id=b.version_id
      WHERE COALESCE(json_extract(v.data,'$.type'),'video')<>'video-group')`;
    const totals = this.db.all<{
      currency: string;
      effective: number | null;
      manualKnown: number;
      tasks: number;
      estimated: number | null;
      actual: number | null;
      actualKnown: number;
      estimateUnknown: number;
      successEstimate: number | null;
      failedEstimate: number | null;
      successActual: number | null;
      failedActual: number | null;
    }>(
      `SELECT currency,sum(effective) effective,count(manual) manualKnown,count(*) tasks,sum(CASE WHEN submitted_at IS NOT NULL THEN COALESCE(usage_estimated,estimated) END) estimated,sum(actual) actual,count(actual) actualKnown,sum(CASE WHEN submitted_at IS NOT NULL AND estimated IS NULL AND usage_estimated IS NULL THEN 1 ELSE 0 END) estimateUnknown,sum(CASE WHEN status='Completed' THEN COALESCE(usage_estimated,estimated) END) successEstimate,sum(CASE WHEN status='Failed' AND submitted_at IS NOT NULL THEN COALESCE(usage_estimated,estimated) END) failedEstimate,sum(CASE WHEN status='Completed' THEN actual END) successActual,sum(CASE WHEN status='Failed' THEN actual END) failedActual FROM ${source} b WHERE ${where} GROUP BY currency`,
      ...p,
    );
    const total =
      this.db.one<{ n: number }>(
        `SELECT count(*) n FROM ${source} b WHERE ${where}`,
        ...p,
      )?.n ?? 0;
    const tasks = this.db
      .all<{
        manual: number | null;
        manual_note: string | null;
        effective: number | null;
        effective_source: string;
        version_id: string;
        account_id: string;
        provider_id: string;
        model_id: string;
        created_at: string;
        submitted_at: string | null;
        status: string;
        currency: string;
        estimated: number | null;
        usage_estimated: number | null;
        actual: number | null;
        data: string;
        snapshot: string;
      }>(
        `SELECT b.*,s.data snapshot FROM ${source} b JOIN task_snapshots s ON s.version_id=b.version_id WHERE ${where} ORDER BY COALESCE(b.submitted_at,b.created_at) DESC LIMIT 40 OFFSET ?`,
        ...p,
        Math.max(0, ((q.page ?? 1) - 1) * 40),
      )
      .map((r) => {
        const snapshot = JSON.parse(r.snapshot) as Task["snapshot"];
        return {
          ...r,
          snapshot: undefined,
          name: snapshot.draft.name || "未命名任务",
          model: snapshot.model.name,
          provider: snapshot.provider.name,
          account: snapshot.account.name,
          duration: snapshot.draft.params.duration,
          resolution: snapshot.draft.params.resolution,
        };
      });
    return { totals, tasks, total };
  }
}

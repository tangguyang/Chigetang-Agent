import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Obj } from "../../../features/realSpeech/domain.ts";
import { canonicalV2, planHash, sha256, strictJSON } from "./validator.ts";
export function loadBatch(path: string) {
  const batch = strictJSON(readFileSync(path, "utf8"));
  if (
    batch.batchId !== "COSYVOICE35PLUS-BATCH1" ||
    batch.model !== "cosyvoice-v3.5-plus" ||
    batch.cases.length !== 16 ||
    new Set(batch.cases.map((c: Obj) => c.caseId)).size !== 16 ||
    batch.cases.some((c: Obj) => c.calls !== 1)
  )
    throw Error("非法第一批矩阵");
  return batch;
}
export function dryRun(batch: Obj) {
  return {
    mode: "DRY_RUN_NO_NETWORK",
    batchId: batch.batchId,
    matrixHash: planHash(batch),
    cases: batch.cases.length,
    plannedCalls: 16,
    estimatedAudio: batch.expectedAudioCount,
    estimate: batch.pricing,
    approval: false,
  };
}
export function validateApproval(batch: Obj, a: Obj, binding: Obj) {
  if (
    a.schema !== "COSYVOICE_SPIKE_APPROVAL_V1" ||
    a.approved !== true ||
    !a.approvedBy?.trim() ||
    !a.approvedAt ||
    Number.isNaN(Date.parse(a.approvedAt)) ||
    a.batchId !== batch.batchId ||
    a.matrixHash !== planHash(batch) ||
    a.voiceRef !== binding.voiceRef ||
    a.accountId !== binding.accountId ||
    a.remoteVoice !== binding.voice ||
    a.workspaceId !== binding.workspaceId ||
    a.model !== batch.model
  )
    throw Error("未取得与矩阵、音色、账户绑定的付费批准");
  if (
    !Array.isArray(a.caseIds) ||
    !a.caseIds.length ||
    new Set(a.caseIds).size !== a.caseIds.length ||
    a.caseIds.some(
      (id: string) => !batch.cases.some((c: Obj) => c.caseId === id),
    ) ||
    a.maxRequests !== a.caseIds.length ||
    a.maxRequests > 16 ||
    !Number.isFinite(a.maxCostCny) ||
    a.maxCostCny <= 0 ||
    a.priceCnyPer10000 !== batch.pricing.cnyPer10000Characters ||
    a.allowNewVoiceEnrollment !== false
  )
    throw Error("批准范围/价格/费用上限不完整");
  return a.caseIds.map((id: string) =>
    batch.cases.find((c: Obj) => c.caseId === id),
  );
}
/** No transport is touched without both explicit execute flag and complete approval. */
export async function executeBatch(
  batch: Obj,
  a: Obj,
  binding: Obj,
  opts: {
    executeApproved: boolean;
    outputRoot: string;
    getKey: () => string;
    submit: (url: string, key: string, body: Obj) => Promise<Obj>;
    download: (url: string, path: string) => Promise<void>;
    pcmHash: (path: string) => Promise<string>;
  },
) {
  if (opts.executeApproved !== true)
    throw Error("未指定执行获批付费测试；默认仅离线");
  const cases = validateApproval(batch, a, binding);
  const approvalHash = planHash(a);
  const dir = join(opts.outputRoot, approvalHash);
  mkdirSync(dir, { recursive: true });
  const ledgerPath = join(dir, "ledger.json");
  if (existsSync(ledgerPath))
    throw Error("此批准已启动，禁止重跑；核对ledger后另批未请求部分");
  const ledger: Obj = {
    status: "approved_started",
    approvalHash,
    batchId: batch.batchId,
    actualCalls: 0,
    actualCostCny: 0,
    results: [],
    startedAt: new Date().toISOString(),
    reportId: randomUUID(),
  };
  const save = () => {
    writeFileSync(ledgerPath + ".tmp", JSON.stringify(ledger, null, 2));
    renameSync(ledgerPath + ".tmp", ledgerPath);
  };
  writeFileSync(ledgerPath, JSON.stringify(ledger), { flag: "wx" });
  let key = "";
  try {
    key = opts.getKey();
    if (!key.trim()) throw Error("凭据不可用");
    for (const c of cases) {
      const charEnvelope = [...(c.input.text + c.input.instruction)].length * 2;
      const estimate = (charEnvelope * a.priceCnyPer10000) / 10000;
      if (
        ledger.actualCalls >= a.maxRequests ||
        ledger.actualCostCny + estimate > a.maxCostCny
      )
        throw Error("达到批准调用或费用上限");
      const body = {
        model: batch.model,
        input: { ...c.input, voice: binding.voice },
      };
      const row: Obj = {
        caseId: c.caseId,
        status: "submitting",
        body,
        requestFingerprint: planHash(body),
        at: new Date().toISOString(),
      };
      ledger.results.push(row);
      ledger.actualCalls++;
      save();
      const r = await opts.submit(binding.url, key, body);
      row.providerRequestId = r.request_id;
      row.usage = r.usage;
      if (typeof r.usage?.characters !== "number") {
        row.status = "billing_unknown";
        save();
        throw Error("用量未知，停止核账");
      }
      const cost = (r.usage.characters * a.priceCnyPer10000) / 10000;
      ledger.actualCostCny += cost;
      if (!r.output?.audio?.url) {
        row.status = "no_audio";
        save();
        throw Error("未返回音频，停止核账");
      }
      const file = join(dir, c.caseId + ".wav");
      await opts.download(r.output.audio.url, file);
      row.wavSha256 = sha256(readFileSync(file));
      row.decodedPcmSha256 = await opts.pcmHash(file);
      row.status = "completed";
      row.listeningObservation = null;
      save();
      if (ledger.actualCostCny > a.maxCostCny)
        throw Error("返回用量超出预算，停止后续请求");
    }
    ledger.status = "completed";
  } catch (e) {
    ledger.status = "stopped_requires_review";
    const last = ledger.results.at(-1);
    const error = e as Obj;
    ledger.error = {
      caseId: last?.caseId || null,
      httpStatus:
        typeof error.details?.httpStatus === "number"
          ? error.details.httpStatus
          : null,
      code:
        typeof error.code === "string"
          ? error.code
          : "local_or_transport_error",
      message: "已停止，查看批准和用量；不导出原始错误以防泄露凭据",
    };
    if (last?.status === "submitting")
      last.status = "unknown_or_rejected_requires_billing_review";
    save();
    throw Error(
      "Spike已停止；没有自动重试。查看脱敏ledger，核对计费后再批准剩余case。",
    );
  } finally {
    key = "";
    save();
  }
  return ledger;
}

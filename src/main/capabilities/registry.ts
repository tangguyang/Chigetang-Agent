import Ajv from "ajv";
import { randomUUID } from "node:crypto";
import { SecretFilter } from "../../cli/output.ts";

export type Params = Record<string, any>;
export const capabilityOutputSchema = {
  type: "object",
  properties: {
    schema: { const: "CHIGETANG_CAPABILITY_RESULT_V1" },
    executionId: { type: "string" },
    capability: { type: "string" },
    status: { enum: ["succeeded", "failed"] },
    result: {},
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" } },
      required: ["code", "message"],
    },
    logs: {
      type: "array",
      items: {
        type: "object",
        properties: { at: { type: "string" }, event: { type: "string" } },
        required: ["at", "event"],
      },
    },
  },
  required: ["schema", "executionId", "capability", "status"],
};
export type Definition = {
  id: string;
  description: string;
  service: string;
  inputSchema: Params;
  outputSchema: Params;
  effect: "read" | "write" | "paid" | "destructive";
};
export type CapabilityRequest = {
  capability: string;
  params?: Params;
  confirm?: boolean;
  responseMode?: "compact" | "normal" | "debug";
};
export type CapabilityResult = {
  schema: "CHIGETANG_CAPABILITY_RESULT_V1";
  executionId: string;
  capability: string;
  status: "succeeded" | "failed";
  result?: unknown;
  error?: { code: string; message: string };
  logs: { at: string; event: string }[];
};
export class CapabilityRegistry {
  private entries = new Map<
    string,
    {
      definition: Definition;
      validate: ReturnType<Ajv["compile"]>;
      execute: (p: Params) => unknown;
    }
  >();
  private queue: Promise<unknown> = Promise.resolve();
  private filter: SecretFilter;
  constructor(filter = new SecretFilter()) {
    this.filter = filter;
  }
  register(definition: Definition, execute: (p: Params) => unknown) {
    if (this.entries.has(definition.id))
      throw Error("重复能力：" + definition.id);
    this.entries.set(definition.id, {
      definition: { ...definition, outputSchema: capabilityOutputSchema },
      validate: new Ajv({ allErrors: true, strict: false }).compile(
        definition.inputSchema,
      ),
      execute,
    });
  }
  list() {
    return [...this.entries.values()]
      .map((e) => e.definition)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  validate(request: CapabilityRequest) {
    if (
      !request ||
      typeof request !== "object" ||
      typeof request.capability !== "string" ||
      (request.confirm !== undefined && typeof request.confirm !== "boolean") ||
      (request.params !== undefined &&
        (!request.params ||
          typeof request.params !== "object" ||
          Array.isArray(request.params))) ||
      Object.keys(request).some(
        (k) => !["capability", "params", "confirm", "responseMode"].includes(k),
      )
    )
      throw Error("请求字段无效");
    if (
      request.responseMode !== undefined &&
      !["compact", "normal", "debug"].includes(request.responseMode)
    )
      throw Error("responseMode无效");
    const entry = this.entries.get(request.capability);
    if (!entry) throw Error("未知能力：" + request.capability);
    const params = request.params ?? {};
    if (!entry.validate(params))
      throw Error("参数校验失败：" + JSON.stringify(entry.validate.errors));
    if (
      ["paid", "destructive"].includes(entry.definition.effect) &&
      request.confirm !== true
    )
      throw Error("该动作需要 confirm:true；未执行");
    return { entry, params };
  }
  executeCapability(request: CapabilityRequest): Promise<CapabilityResult> {
    // One mutation queue shared by every transport; status reads remain live.
    if (
      this.entries.get(request?.capability)?.definition.effect === "read" ||
      request?.capability === "jobs.submit"
    )
      return this.perform(request);
    const job = this.queue.then(() => this.perform(request));
    this.queue = job.catch(() => {});
    return job;
  }
  private async perform(request: CapabilityRequest): Promise<CapabilityResult> {
    const executionId = randomUUID(),
      logs = [{ at: new Date().toISOString(), event: "accepted" }];
    try {
      const { entry, params } = this.validate(request);
      const result = await entry.execute(params);
      logs.push({ at: new Date().toISOString(), event: "completed" });
      return this.filter.clean({
        schema: "CHIGETANG_CAPABILITY_RESULT_V1",
        executionId,
        capability: request.capability,
        status: "succeeded",
        result: result ?? null,
        logs,
      }) as CapabilityResult;
    } catch (error) {
      logs.push({ at: new Date().toISOString(), event: "failed" });
      return this.filter.clean({
        schema: "CHIGETANG_CAPABILITY_RESULT_V1",
        executionId,
        capability:
          typeof request?.capability === "string"
            ? request.capability
            : "unknown",
        status: "failed",
        ...((error as any)?.partialResult
          ? { result: (error as any).partialResult }
          : {}),
        error: {
          code: "CAPABILITY_REJECTED",
          message: error instanceof Error ? error.message : "执行失败",
        },
        logs,
      }) as CapabilityResult;
    }
  }
  registerWorkflow() {
    const stepSchema = objectSchema(
      {
        id: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" },
        capability: stringSchema,
        params: { type: "object" },
        confirm: { type: "boolean" },
      },
      ["id", "capability"],
    );
    this.register(
      {
        id: "workflow.run",
        description:
          "顺序执行最多30个能力，失败即停止；$ref: stepId.result.field 引用前一步结果。不会自动重试或撤销。",
        service: "CapabilityRegistry",
        effect: "write",
        inputSchema: objectSchema(
          {
            steps: {
              type: "array",
              items: stepSchema,
              minItems: 1,
              maxItems: 30,
            },
          },
          ["steps"],
        ),
        outputSchema: { type: "object" },
      },
      async (p) => {
        const ids = new Set<string>();
        for (const step of p.steps) {
          if (ids.has(step.id) || step.capability === "workflow.run")
            throw Error("重复step id或嵌套工作流");
          if (!this.entries.has(step.capability))
            throw Error("未知能力：" + step.capability);
          const effect = this.entries.get(step.capability)!.definition.effect;
          if (["paid", "destructive"].includes(effect) && step.confirm !== true)
            throw Error("工作流含未确认动作；全部步骤未执行");
          let hasReference = false;
          const check = (v: any) => {
            if (v && typeof v === "object") {
              if (Object.hasOwn(v, "$ref")) {
                hasReference = true;
                if (
                  Object.keys(v).length !== 1 ||
                  typeof v.$ref !== "string" ||
                  !ids.has(v.$ref.split(".")[0])
                )
                  throw Error("引用须指向前一步结果");
              } else for (const x of Object.values(v)) check(x);
            }
          };
          check(step.params);
          if (!hasReference)
            this.validate({
              capability: step.capability,
              params: step.params ?? {},
              confirm: step.confirm ?? false,
            });
          ids.add(step.id);
        }
        const results: Record<string, CapabilityResult> = {};
        const substitute = (value: any): any => {
          if (Array.isArray(value)) return value.map(substitute);
          if (value && typeof value === "object") {
            if (
              Object.keys(value).length === 1 &&
              typeof value.$ref === "string"
            ) {
              const keys = value.$ref.split(".");
              let out: any = results;
              for (const key of keys) {
                if (
                  ["__proto__", "prototype", "constructor"].includes(key) ||
                  !out ||
                  !Object.hasOwn(out, key)
                )
                  throw Error("工作流引用无效：" + value.$ref);
                out = out[key];
              }
              return structuredClone(out);
            }
            return Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, substitute(v)]),
            );
          }
          return value;
        };
        for (const step of p.steps) {
          let params;
          try {
            params = substitute(step.params ?? {});
          } catch (error) {
            throw Object.assign(error as Error, {
              partialResult: { steps: results, failedStep: step.id },
            });
          }
          const result = await this.perform({
            capability: step.capability,
            params,
            confirm: step.confirm ?? false,
          });
          results[step.id] = result;
          if (result.status === "failed")
            throw Object.assign(
              Error("工作流在 " + step.id + " 停止：" + result.error?.message),
              { partialResult: { steps: results, failedStep: step.id } },
            );
        }
        return { steps: results };
      },
    );
  }
}
export const objectSchema = (
  properties: Params = {},
  required: string[] = [],
  additionalProperties = false,
): Params => ({ type: "object", properties, required, additionalProperties });
export const stringSchema = { type: "string", minLength: 1 };

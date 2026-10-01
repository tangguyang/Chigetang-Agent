export class SecretFilter {
  private secrets = new Set<string>();
  remember(value: string) {
    if (value) this.secrets.add(value);
  }
  text(value: string) {
    for (const secret of this.secrets)
      value = value.replaceAll(secret, "[REDACTED]");
    return value
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
      .replace(/\bBearer\s+[^\s"<>]+/gi, "Bearer [REDACTED]")
      .replace(
        /([?&](?:token|signature|access_key|api_key|security-token)=)[^&\s]+/gi,
        "$1[REDACTED]",
      );
  }
  clean(value: unknown): any {
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value)) return value.map((x) => this.clean(x));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key]) =>
              !/^(?:key|api[_-]?key|authorization|encrypted|secret|secretKey|accessToken|credentials|headers|keyEnc)$/i.test(
                key,
              ),
          )
          .map(([k, v]) => [k, this.clean(v)]),
      );
    return value;
  }
}
export function resultOutput(
  command: string,
  data: unknown,
  filter: SecretFilter,
  error = false,
) {
  return (
    JSON.stringify(
      filter.clean(
        error
          ? {
              ok: false,
              schema: "CHIGETANG_AGENT_CLI_RESULT_V1",
              command,
              error: { code: "COMMAND_REJECTED", message: String(data) },
            }
          : {
              ok: true,
              schema: "CHIGETANG_AGENT_CLI_RESULT_V1",
              command,
              data,
            },
      ),
    ) + "\n"
  );
}

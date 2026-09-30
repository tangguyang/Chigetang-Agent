export function normalizeWorkspace(value: string) {
  return value.trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
}
export function validateWorkspace(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value) || value.length > 128)
    throw new Error(
      "Workspace ID 未填写或格式不正确；支持 ws- 开头的业务空间 ID，请检查所选账户。",
    );
}

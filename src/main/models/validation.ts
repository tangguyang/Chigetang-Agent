import { validDuration } from "../../shared/duration.ts";
import { extname } from "node:path";
import type { Snapshot } from "../../shared/types.ts";
import { AppError } from "../services/errors.ts";
import { formatWanIssue, wanPreflight } from "../../shared/wanPreflight.ts";
export function validateInput(s: Snapshot) {
  const { capabilities: c } = s.model;
  const fail = (m: string): never => {
    throw new AppError("ValidationError", m);
  };
  if (!s.model.enabled) fail("当前模型尚未启用，请先完成模型与 API 配置。");
  if (
    s.account.providerId !== s.provider.id ||
    s.model.providerId !== s.provider.id
  )
    fail("模型与 API 账户的服务商不一致。");
  if (!s.account.enabled) fail("当前账户已停用。");
  if (!s.draft.prompt.trim() && !s.assets.length)
    fail("请填写 Prompt 或添加参考素材。");
  if ([...s.draft.prompt].length > c.promptLimit)
    fail(
      `Prompt 超过${s.model.adapter === "seedance" ? "本地编辑器" : "当前模型"} ${c.promptLimit} 字符限制，请缩短后提交。不会自动截断。`,
    );
  for (const [key, value] of Object.entries(s.draft.params)) {
    const p = c.parameters.find((p) => p.key === key);
    if (!p) fail(`当前模型不支持参数 ${key}。`);
    else if (p.type === "boolean" && typeof value !== "boolean")
      fail(`${p.label} 参数无效。`);
    else if (p.type === "select" && !p.options?.includes(String(value)))
      fail(`${p.label} 参数无效。`);
    else if (
      p.type === "number" &&
      (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < (p.min ?? -Infinity) ||
        value > (p.max ?? Infinity))
    )
      fail(`${p.label} 超出模型范围。`);
  }
  if (
    !Number.isFinite(s.draft.params.duration) ||
    s.draft.params.duration === 0
  )
    fail("请选择当前模型支持的合法时长，0 不能提交。");
  const duration = Number(s.draft.params.duration);
  if (s.model.adapter === "wan3" && duration !== -1 && duration < 2)
    fail("Wan 3.0 输出时长至少 2 秒；精准复刻建议 3–10 秒。");
  if (s.model.adapter === "wan3") {
    const issue = wanPreflight(s.model, s.draft, s.assets).issues.find(
      (item) => item.severity === "error",
    );
    if (issue) fail(formatWanIssue(issue));
  }
  if (s.model.adapter === "seedance") {
    if (duration !== -1 && duration < 4)
      fail("Seedance 输出时长至少 4 秒，或选择 -1 智能时长。");
    const localBytes =
      s.assets
        .filter((a) => !a.remoteUrl && a.kind !== "video")
        .reduce((n, a) => n + Math.ceil((a.size * 4) / 3), 0) +
      Buffer.byteLength(s.draft.prompt);
    if (localBytes > 60 * 1024 * 1024)
      fail("编码后的请求接近 64 MB 限制，请为大文件设置官方可访问 URL。");
    for (const a of s.assets) {
      if (a.kind === "video" && !a.remoteUrl)
        fail(
          `${a.name} 需要公网素材 URL。请在资产库详情填写官方可访问 URL 后再提交。`,
        );
      if (
        a.kind === "video" &&
        ((a.width ?? 0) * (a.height ?? 0) < 407696 ||
          (a.width ?? 0) * (a.height ?? 0) > 8295044 ||
          (a.fps ?? 0) > 60)
      )
        fail(`${a.name} 总像素数或 FPS 不符合 Seedance 限制。`);
    }
    if (s.model.id === "seedance25") {
      const type = s.draft.params.omni_reference_task_type;
      const frames = s.assets.some(
        (a) => a.role === "first_frame" || a.role === "last_frame",
      );
      if (
        (type === "edit" || type === "extend") &&
        !s.assets.some((a) => a.kind === "video")
      )
        fail("编辑或延长任务必须提供参考视频。");
      if (
        (type === "edit" || type === "extend" || frames) &&
        s.draft.params.ratio !== "adaptive"
      )
        fail("Seedance 2.5 编辑、延长和首尾帧任务的比例必须为 adaptive。");
      if (
        type === "edit" &&
        (duration !== -1 ||
          s.assets
            .filter((a) => a.kind === "video")
            .some((a) => (a.duration ?? 0) < 4))
      )
        fail("Seedance 2.5 编辑任务要求 duration=-1，待编辑视频至少 4 秒。");
    }
  }
  if (!validDuration(s.model, s.draft.params, s.assets))
    fail("请选择当前模型支持的合法时长。");
  const first = s.assets.filter((a) => a.role === "first_frame"),
    last = s.assets.filter((a) => a.role === "last_frame"),
    references = s.assets.filter((a) => a.role.startsWith("reference_"));
  if (first.length > 1 || last.length > 1) fail("首帧和尾帧分别只能添加一张。");
  if (last.length && !first.length) fail("使用尾帧时请同时提供首帧。");
  if (
    (first.length || last.length) &&
    references.length &&
    !c.supportsMixedFrameReferences
  )
    fail(
      "当前模型接口不支持首尾帧与补充参考混合提交；请移除补充素材或改用自由参考，素材不会被忽略。",
    );
  for (const a of s.assets) {
    if (!c.roles.includes(a.role)) fail(`此模型不支持 ${a.role}。`);
    const kind =
      a.role.includes("image") || a.role.endsWith("frame")
        ? "image"
        : a.role.includes("video")
          ? "video"
          : "audio";
    if (a.kind !== kind) fail(`${a.name} 的类型与素材槽位不一致。`);
    const l = c.limits[a.kind];
    if (!l) fail("模型不支持此类素材。");
    else {
      if (
        !l.extensions.includes(
          (extname(a.managedPath || a.originalPath) || extname(a.name))
            .slice(1)
            .toLowerCase(),
        )
      )
        fail(`${a.name} 格式不符合当前模型要求。`);
      if (a.size > l.maxMB * 1024 * 1024)
        fail(`${a.name} 超过 ${l.maxMB} MB 限制。`);
      if (l.minSide || l.maxSide) {
        if (!a.width || !a.height)
          fail(`${a.name} 无法读取分辨率，请重新导入有效素材。`);
        if (
          Math.min(a.width!, a.height!) < (l.minSide ?? 0) ||
          Math.max(a.width!, a.height!) > (l.maxSide ?? Infinity)
        )
          fail(`${a.name} 分辨率不符合要求。`);
        if (
          Math.max(a.width! / a.height!, a.height! / a.width!) >
          (l.maxRatio ?? Infinity)
        )
          fail(`${a.name} 长宽比超出限制。`);
      }
      if (l.maxSeconds) {
        if (!a.duration) fail(`${a.name} 无法读取时长。`);
        if (a.duration! < (l.minSeconds ?? 0) || a.duration! > l.maxSeconds)
          fail(`${a.name} 时长不符合 ${l.minSeconds}–${l.maxSeconds} 秒要求。`);
      }
      if (l.minFPS && (!a.fps || a.fps < l.minFPS))
        fail(`${a.name} 帧率低于 ${l.minFPS} fps 或无法读取。`);
      if (s.model.adapter === "wan3" && a.hasAlpha)
        fail(
          `${a.name} 包含透明通道，Wan 不支持。请自行提供无透明通道的真实母图。`,
        );
    }
  }
  for (const kind of ["image", "video", "audio"] as const) {
    const arr = s.assets.filter((a) => a.kind === kind),
      l = c.limits[kind];
    if (l && arr.length > l.maxCount)
      fail(`当前模型最多允许 ${l.maxCount} 个${kind}素材。`);
    if (
      l?.totalSeconds &&
      arr.reduce((n, a) => n + (a.duration ?? 0), 0) > l.totalSeconds
    )
      fail(`${kind} 素材总时长不能超过 ${l.totalSeconds} 秒。`);
  }
  if (
    s.model.capabilities.inputOutputDurationLimit &&
    duration !== -1 &&
    s.assets
      .filter((a) => a.kind === "video")
      .reduce((n, a) => n + (a.duration ?? 0), 0) +
      duration >
      s.model.capabilities.inputOutputDurationLimit
  )
    fail(
      `参考视频总时长与输出时长之和不能超过 ${s.model.capabilities.inputOutputDurationLimit} 秒。`,
    );
}

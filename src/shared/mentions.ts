import type { Asset, AssetBinding, Draft, Mention } from "./types.ts";
export interface MentionCandidate {
  bindingId: string;
  assetId: string;
  label: string;
  name: string;
  kind: Asset["kind"];
  role: AssetBinding["role"];
  userRole: string;
  asset: Asset;
}
export const usageRoles = [
  "原视频模板",
  "包装正面",
  "包装立体",
  "包装侧面",
  "内袋",
  "人物",
  "故事板",
  "其他",
];
export function normalizeDraft(draft: Draft): Draft {
  return {
    ...draft,
    draftId: draft.draftId || crypto.randomUUID(),
    mentions: draft.mentions ?? [],
    assets: draft.assets.map((a, i) => ({
      ...a,
      bindingId: a.bindingId || `${a.assetId}:${a.role}:${i}`,
    })),
  };
}
export function mentionCandidates(
  bindings: AssetBinding[],
  assets: Asset[],
  query = "",
): MentionCandidate[] {
  const counts: Record<string, number> = {};
  return bindings
    .map((b, i) => {
      const asset = assets.find((a) => a.id === b.assetId);
      if (!asset) return null;
      const prefix =
        b.role === "first_frame"
          ? "FirstFrame"
          : b.role === "last_frame"
            ? "LastFrame"
            : asset.kind === "image"
              ? "Image"
              : asset.kind === "video"
                ? "Video"
                : "Audio";
      const index = (counts[prefix] = (counts[prefix] ?? 0) + 1);
      return {
        bindingId: b.bindingId || `${b.assetId}:${b.role}:${i}`,
        assetId: b.assetId,
        label: prefix + index,
        name: asset.name,
        kind: asset.kind,
        role: b.role,
        userRole: b.userRole || "其他",
        asset,
      };
    })
    .filter((a): a is MentionCandidate => a !== null)
    .filter((a) =>
      [a.label, a.name, a.userRole].some((t) =>
        t.toLowerCase().includes(query.toLowerCase()),
      ),
    );
}
/** Track bindings through arbitrary text edits. Editing inside a token removes only that token binding. */
export function rebaseMentions(
  before: string,
  after: string,
  mentions: Mention[],
): Mention[] {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let oldEnd = before.length,
    newEnd = after.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;
  return mentions
    .flatMap((m) => {
      if (m.end <= start) return [m];
      if (m.start >= oldEnd)
        return [{ ...m, start: m.start + delta, end: m.end + delta }];
      return [];
    })
    .filter((m) => after.slice(m.start, m.end) === "@" + m.label);
}

const TEXT_MENTION = /@(Image|Video|Audio|FirstFrame|LastFrame)\s*(\d+)\b/g;

/** Turn copied textual @Image 1 / @Video1 tokens into stable asset bindings. */
export function autoBindMentions(draft: Draft, assets: Asset[]): Draft {
  const candidates = mentionCandidates(draft.assets, assets);
  let prompt = draft.prompt;
  // Canonicalise the optional-space spelling so mention offsets stay deterministic.
  prompt = prompt.replace(
    TEXT_MENTION,
    (_token, type, index) => `@${type}${Number(index)}`,
  );
  let mentions = rebaseMentions(
    draft.prompt,
    prompt,
    draft.mentions ?? [],
  ).filter((mention) =>
    candidates.some(
      (candidate) =>
        candidate.bindingId === mention.bindingId &&
        candidate.assetId === mention.assetId,
    ),
  );
  for (const match of prompt.matchAll(TEXT_MENTION)) {
    const start = match.index;
    if (mentions.some((mention) => mention.start === start)) continue;
    const label = `${match[1]}${Number(match[2])}`;
    const candidate = candidates.find((item) => item.label === label);
    if (!candidate) continue;
    mentions.push({
      id: crypto.randomUUID(),
      assetId: candidate.assetId,
      bindingId: candidate.bindingId,
      start,
      end: start + match[0].length,
      label,
    });
  }
  mentions = mentions.sort((a, b) => a.start - b.start);
  return { ...draft, prompt, mentions };
}

export function missingTextMentions(draft: Draft) {
  const bound = new Set((draft.mentions ?? []).map((mention) => mention.start));
  return [...draft.prompt.matchAll(TEXT_MENTION)]
    .filter((match) => !bound.has(match.index))
    .map((match) => `${match[1]}${Number(match[2])}`);
}
export function insertMention(
  draft: Draft,
  start: number,
  end: number,
  candidate: MentionCandidate,
): Draft {
  const token = "@" + candidate.label;
  const prompt =
    draft.prompt.slice(0, start) + token + " " + draft.prompt.slice(end);
  const mentions = rebaseMentions(draft.prompt, prompt, draft.mentions ?? []);
  mentions.push({
    id: crypto.randomUUID(),
    assetId: candidate.assetId,
    bindingId: candidate.bindingId,
    start,
    end: start + token.length,
    label: candidate.label,
  });
  return {
    ...draft,
    prompt,
    mentions: mentions.sort((a, b) => a.start - b.start),
  };
}
export function compilePrompt(
  draft: Draft,
  assets: Asset[],
  adapter: string,
): string {
  const candidates = mentionCandidates(draft.assets, assets);
  const mentions = [...(draft.mentions ?? [])].sort(
    (a, b) => a.start - b.start,
  );
  let lastEnd = 0;
  for (const m of mentions) {
    if (
      m.start < lastEnd ||
      draft.prompt.slice(m.start, m.end) !== "@" + m.label
    )
      throw new Error("素材引用位置已变化，请删除失效 Token 后重新 @选择。");
    lastEnd = m.end;
  }
  // A copied textual token must not silently bind to a different image.
  const missing = missingTextMentions(draft);
  if (missing.length)
    throw new Error(
      `素材引用未绑定：@${missing[0]} 未找到对应素材。请添加同类型的第 ${missing[0].match(/\d+$/)?.[0]} 个素材。`,
    );
  let result = draft.prompt;
  for (const m of [...mentions].reverse()) {
    const target = candidates.find(
      (c) => c.bindingId === m.bindingId && c.assetId === m.assetId,
    );
    if (!target)
      throw new Error(
        `引用 @${m.label} 的素材已从任务移除，请重新选择或删除引用。`,
      );
    const prefix =
      adapter === "wan3"
        ? {
            Image: "图",
            Video: "视频",
            Audio: "音频",
            FirstFrame: "首帧图",
            LastFrame: "尾帧图",
          }
        : {
            Image: "图片",
            Video: "视频",
            Audio: "音频",
            FirstFrame: "首帧图",
            LastFrame: "尾帧图",
          };
    let rendered = target.label.replace(
      /^(Image|Video|Audio|FirstFrame|LastFrame)/,
      (k) => prefix[k as keyof typeof prefix],
    );
    if (["wan3", "seedance"].includes(adapter) && target.userRole !== "其他")
      rendered += `（用途：${target.userRole}）`;
    result = result.slice(0, m.start) + rendered + result.slice(m.end);
  }
  return result;
}

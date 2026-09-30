import {
  Copy,
  Maximize2,
  Minimize2,
  Redo2,
  Save,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  autoBindMentions,
  insertMention,
  missingTextMentions,
  mentionCandidates,
  rebaseMentions,
  type MentionCandidate,
} from "../../shared/mentions.ts";
import type {
  Asset,
  AssetBinding,
  Draft,
  Mention,
} from "../../shared/types.ts";
import { api, media, run } from "../store.ts";
import { Field, Modal } from "./common.tsx";
export function PromptEditor({
  value,
  onChange,
  limit,
  mentions = [],
  assets = [],
  bindings = [],
}: {
  value: string;
  onChange: (v: string, m?: Mention[]) => void;
  limit: number;
  mentions?: Mention[];
  assets?: Asset[];
  bindings?: AssetBinding[];
}) {
  const [full, setFull] = useState(false),
    [find, setFind] = useState(false),
    [search, setSearch] = useState(""),
    [replace, setReplace] = useState(""),
    [save, setSave] = useState(false),
    [name, setName] = useState(""),
    [favorite, setFavorite] = useState(false);
  const [menu, setMenu] = useState<{
      start: number;
      end: number;
      query: string;
    } | null>(null),
    [choice, setChoice] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null),
    overlay = useRef<HTMLPreElement>(null),
    composing = useRef(false);
  const history = useRef([{ value, mentions }]);
  const cursor = useRef(0);
  const candidates = mentionCandidates(bindings, assets, menu?.query ?? "");
  function change(v: string, m = rebaseMentions(value, v, mentions)) {
    const bound = autoBindMentions(
      { prompt: v, mentions: m, assets: bindings } as Draft,
      assets,
    );
    v = bound.prompt;
    m = bound.mentions ?? [];
    history.current = history.current.slice(0, cursor.current + 1);
    history.current.push({ value: v, mentions: m });
    if (history.current.length > 200) history.current.shift();
    cursor.current = history.current.length - 1;
    onChange(v, m);
  }
  useEffect(() => {
    // Asset details load asynchronously; never discard stable mentions during that gap.
    if (assets.length !== bindings.length) return;
    const bound = autoBindMentions(
      { prompt: value, mentions, assets: bindings } as Draft,
      assets,
    );
    if (
      bound.prompt !== value ||
      JSON.stringify(bound.mentions ?? []) !== JSON.stringify(mentions)
    )
      onChange(bound.prompt, bound.mentions);
  }, [value, mentions, assets, bindings]);
  function undo(delta: number) {
    cursor.current = Math.max(
      0,
      Math.min(history.current.length - 1, cursor.current + delta),
    );
    const h = history.current[cursor.current];
    onChange(h.value, h.mentions);
    setMenu(null);
  }
  function detect(v: string, pos: number) {
    if (composing.current) return;
    const match = v.slice(0, pos).match(/@([^\s@]*)$/);
    if (match) {
      setMenu({ start: pos - match[0].length, end: pos, query: match[1] });
      setChoice(0);
    } else setMenu(null);
  }
  function select(candidate: MentionCandidate) {
    if (!menu) return;
    const fake = { prompt: value, mentions, assets: bindings } as Draft;
    const next = insertMention(fake, menu.start, menu.end, candidate);
    change(next.prompt, next.mentions);
    const position = menu.start + candidate.label.length + 2;
    setMenu(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(position, position);
    });
  }
  function findNext() {
    if (!search || !ref.current) return;
    const start = value.indexOf(search, ref.current.selectionEnd);
    const at = start < 0 ? value.indexOf(search) : start;
    if (at >= 0) {
      ref.current.focus();
      ref.current.setSelectionRange(at, at + search.length);
    }
  }
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  let end = 0;
  const highlight = sorted.flatMap((m) => {
    const before = value.slice(end, m.start);
    end = m.end;
    return [before, <mark key={m.id}>{value.slice(m.start, m.end)}</mark>];
  });
  highlight.push(value.slice(end) + "\n");
  return (
    <>
      <div className={`prompt-editor ${full ? "fullscreen-editor" : ""}`}>
        <div className="editor-heading">
          <div>
            <span className="eyebrow">提示词</span>
            <h3>描述你的画面</h3>
          </div>
          <div className="toolbar">
            <button title="撤销" onClick={() => undo(-1)}>
              <Undo2 size={16} />
            </button>
            <button title="重做" onClick={() => undo(1)}>
              <Redo2 size={16} />
            </button>
            <button title="搜索与替换" onClick={() => setFind(!find)}>
              <Search size={16} />
            </button>
            <button
              title="复制 Prompt"
              onClick={() =>
                void run(
                  () => navigator.clipboard.writeText(value),
                  "已复制 Prompt 文本；跨任务请使用复制任务以保留素材绑定",
                )
              }
            >
              <Copy size={16} />
            </button>
            <button title="保存为模板" onClick={() => setSave(true)}>
              <Save size={16} />
            </button>
            <button
              title="清空"
              onClick={() =>
                void run(async () => {
                  if (
                    await api<boolean>("dialog.confirm", {
                      message: "清空当前 Prompt？素材和历史记录不受影响。",
                    })
                  )
                    change("", []);
                })
              }
            >
              <Trash2 size={16} />
            </button>
            <button title="全屏编辑" onClick={() => setFull(!full)}>
              {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>
        {find && (
          <div className="find-row">
            <input
              placeholder="查找文本"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input
              placeholder="替换为"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
            />
            <button onClick={findNext}>下一个</button>
            <button
              disabled={!search}
              onClick={() => change(value.replaceAll(search, replace))}
            >
              替换全部
            </button>
          </div>
        )}
        <div className="mention-editor">
          <pre ref={overlay} aria-hidden="true" className="mention-overlay">
            {highlight}
          </pre>
          <textarea
            data-prompt
            ref={ref}
            value={value}
            placeholder={
              "输入完整 Prompt，输入 @ 引用当前任务素材…\n\n选择素材后，可以通过 @Video1、@Image1 明确指代。"
            }
            spellCheck={false}
            onChange={(e) => {
              change(e.target.value);
              detect(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) => detect(value, e.currentTarget.selectionStart)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(e) => {
              composing.current = false;
              detect(e.currentTarget.value, e.currentTarget.selectionStart);
            }}
            onScroll={(e) => {
              if (overlay.current) {
                overlay.current.scrollTop = e.currentTarget.scrollTop;
                overlay.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (menu) {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu(null);
                  return;
                }
                if (["ArrowUp", "ArrowDown"].includes(e.key)) {
                  e.preventDefault();
                  setChoice(
                    (i) =>
                      (i +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        Math.max(candidates.length, 1)) %
                      Math.max(candidates.length, 1),
                  );
                  return;
                }
                if (e.key === "Enter" && candidates.length) {
                  e.preventDefault();
                  e.stopPropagation();
                  select(candidates[Math.min(choice, candidates.length - 1)]);
                  return;
                }
              }
              if (e.ctrlKey && e.key.toLowerCase() === "z") {
                e.preventDefault();
                undo(e.shiftKey ? 1 : -1);
              }
              if (e.ctrlKey && e.key.toLowerCase() === "y") {
                e.preventDefault();
                undo(1);
              }
              if (e.ctrlKey && e.key === "f") {
                e.preventDefault();
                setFind(true);
              }
              if (e.ctrlKey && e.key === "s") {
                e.preventDefault();
                setSave(true);
              }
            }}
          />
          {menu && (
            <div className="mention-menu" role="listbox" aria-label="素材引用">
              <small>选择当前任务素材 · ↑↓ 选择 / Enter 确认 / Esc 关闭</small>
              {!candidates.length ? (
                <p>没有匹配素材，请先从资产库选择。</p>
              ) : (
                candidates.map((c, i) => (
                  <button
                    type="button"
                    key={c.bindingId}
                    role="option"
                    aria-selected={choice === i}
                    className={choice === i ? "selected" : ""}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(c)}
                  >
                    {c.kind === "image" || c.asset.thumbnailPath ? (
                      <img src={media("thumb", c.assetId)} alt="" />
                    ) : (
                      <span className="mention-type">
                        {c.kind === "video" ? "视频" : "音频"}
                      </span>
                    )}
                    <span>
                      <strong>@{c.label}</strong>
                      <small>
                        {c.name} · {c.userRole}
                      </small>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {mentions.length > 0 && (
          <div className="mention-bindings">
            {mentions.map((m) => {
              const target = mentionCandidates(bindings, assets).find(
                (c) => c.bindingId === m.bindingId,
              );
              return (
                <span
                  className={`mention-chip ${target ? "" : "missing"}`}
                  key={m.id}
                  title={`Asset ID: ${m.assetId}`}
                >
                  <b>@{m.label}</b>
                  <span>
                    {target
                      ? `${target.name}${target.label !== m.label ? ` → ${target.label}` : ""}`
                      : "素材已移除"}
                  </span>
                  <button
                    title="删除此引用"
                    onClick={() =>
                      change(value.slice(0, m.start) + value.slice(m.end))
                    }
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {missingTextMentions({ prompt: value, mentions } as Draft).map(
          (label) => (
            <p className="notice warning" key={label}>
              @{label} 未找到对应素材。
            </p>
          ),
        )}
        <footer>
          <span className={value.length > limit ? "danger" : ""}>
            {[...value].length.toLocaleString()} / {limit.toLocaleString()} 字符
          </span>
          <span>
            <i className="dot" /> 自动保存 · @素材引用
          </span>
        </footer>
      </div>
      {save && (
        <Modal title="保存 Prompt 模板" onClose={() => setSave(false)}>
          <Field label="模板名称">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
            />
            收藏模板
          </label>
          <p className="muted">
            模板保存文字；跨任务完整复用素材引用请使用“复制任务”。
          </p>
          <button
            className="primary"
            onClick={() =>
              void run(async () => {
                await api("prompts.save", { name, content: value, favorite });
                setSave(false);
              }, "模板已保存")
            }
          >
            保存模板
          </button>
        </Modal>
      )}
    </>
  );
}

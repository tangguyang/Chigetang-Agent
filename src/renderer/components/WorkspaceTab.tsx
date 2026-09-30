import { useRef, useState } from "react";
import { X } from "lucide-react";
export function WorkspaceTab({
  name,
  active,
  onOpen,
  onClose,
  onRename,
}: {
  name: string;
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState("");
  const done = useRef(false);
  function finish(cancel = false) {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (!cancel) onRename(value.trim());
  }
  return (
    <div className={`workspace-tab ${active ? "active" : ""}`}>
      {editing ? (
        <input
          aria-label="工作区名称"
          autoFocus
          maxLength={100}
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => finish()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              finish(e.key === "Escape");
            }
          }}
        />
      ) : (
        <button
          className="workspace-tab-main"
          onClick={onOpen}
          onDoubleClick={() => {
            done.current = false;
            setValue(name === "未命名任务" ? "" : name);
            setEditing(true);
          }}
          title="双击改名"
        >
          {name || "未命名任务"}
        </button>
      )}
      <button
        className="workspace-tab-close"
        title="关闭工作区（草稿仍保留）"
        onClick={onClose}
      >
        <X size={13} />
      </button>
    </div>
  );
}

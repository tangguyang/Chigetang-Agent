import { useState } from "react";
export function ratioDimensions(ratio: string) {
  const [w, h] = ratio.split(":").map(Number);
  return w > 0 && h > 0
    ? {
        width: Math.round(((30 * w) / Math.max(w, h)) * 100) / 100,
        height: Math.round(((30 * h) / Math.max(w, h)) * 100) / 100,
      }
    : { width: 26, height: 22 };
}
export function RatioIcon({ ratio }: { ratio: string }) {
  const size = ratioDimensions(ratio);
  return (
    <span className="ratio-preview">
      <span
        data-ratio={ratio}
        style={{ width: size.width, height: size.height }}
      >
        {ratio === "adaptive" ? "A" : null}
      </span>
    </span>
  );
}
export function RatioPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ratio-picker">
      <button
        type="button"
        aria-label="画面比例"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <RatioIcon ratio={value} />
        {value === "adaptive" ? "自适应" : value}
        <span>⌄</span>
      </button>
      {open && (
        <>
          <button
            className="popover-dismiss"
            tabIndex={-1}
            aria-label="关闭比例菜单"
            onClick={() => setOpen(false)}
          />
          <div
            className="ratio-menu"
            role="listbox"
            aria-label="比例选项"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            {options.map((r) => (
              <button
                key={r}
                type="button"
                role="option"
                aria-selected={value === r}
                className={value === r ? "selected" : ""}
                onClick={() => {
                  onChange(r);
                  setOpen(false);
                }}
              >
                <RatioIcon ratio={r} />
                <span>{r === "adaptive" ? "自适应" : r}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

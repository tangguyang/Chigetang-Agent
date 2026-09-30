import { useEffect, useRef, useState } from "react";
import {
  TRANSCRIPTION_STAGE_LABELS,
  type TranscriptionProgress,
  type TranscriptionSource,
} from "../../shared/transcription.ts";
import {
  Bot,
  FileText,
  FolderOpen,
  Upload,
  Music,
  Film,
  X,
} from "lucide-react";
import { api, useApp } from "../store.ts";

export function TranscriptionPage() {
  const message = useApp((state) => state.message);
  const [source, setSource] = useState<TranscriptionSource | null>(null);
  const [progress, setProgress] = useState<TranscriptionProgress>({
    stage: "idle",
    busy: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const locked = useRef(false);
  const restored = useRef(false);
  const busy = progress.busy || pending || !loaded;
  const result = progress.result;
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const current = await api<TranscriptionProgress>(
          "transcription.progress",
        );
        if (!disposed && current) {
          setProgress(current);
          setLoaded(true);
          if (
            !restored.current &&
            (current.source || current.stage === "idle")
          ) {
            if (current.source) setSource(current.source);
            restored.current = true;
          }
        }
      } catch (e) {
        if (!disposed)
          setError(e instanceof Error ? e.message : "读取任务状态失败");
      }
      if (!disposed) timer = setTimeout(refresh, 500);
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
  const choose = async (path?: string) => {
    if (busy || locked.current) return;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      const file = await api<TranscriptionSource | null>(
        path ? "transcription.inspect" : "transcription.select",
        path ? { path } : undefined,
      );
      if (file) {
        restored.current = true;
        setSource(file);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setPending(false);
      locked.current = false;
    }
  };
  const start = async () => {
    if (!source || busy || locked.current) return;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      setProgress(
        await api<TranscriptionProgress>("transcription.start", {
          path: source.path,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败");
    } finally {
      setPending(false);
      locked.current = false;
    }
  };
  const cancel = async () => {
    setPending(true);
    try {
      setProgress(await api<TranscriptionProgress>("transcription.cancel"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消失败");
    } finally {
      setPending(false);
    }
  };
  const resultAction = async (
    kind: "full" | "timeline" | "folder",
    copy = false,
  ) => {
    if (!result) return;
    try {
      await api(copy ? "transcription.copy" : "transcription.openResult", {
        taskId: result.taskId,
        kind,
      });
      if (copy) message("已复制逐字稿");
    } catch (e) {
      message(e instanceof Error ? e.message : "操作失败");
    }
  };
  const open = async (action: string, label: string) => {
    try {
      await api(action);
    } catch (error) {
      message(
        `${label}失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return (
    <section className="transcription-page">
      <div className="page-title transcription-page-title">
        <div>
          <h1 className="transcription-title">
            音视频转文字
            <span
              className="transcription-title-actions"
              aria-label="转文字快捷入口"
            >
              <button
                type="button"
                className="icon-button"
                aria-label="打开转文字任务保存文件夹"
                title="打开转文字任务保存文件夹"
                onClick={() =>
                  void open(
                    "transcription.openOutputFolder",
                    "打开任务保存文件夹",
                  )
                }
              >
                <FolderOpen size={22} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="打开本地识别模型保存目录"
                title="打开本地识别模型保存目录"
                onClick={() =>
                  void open("transcription.openModelFolder", "打开模型保存目录")
                }
              >
                <Bot size={22} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="打开模型下载安装说明"
                title="打开模型下载安装说明"
                onClick={() =>
                  void open("transcription.openGuide", "打开模型安装说明")
                }
              >
                <FileText size={22} />
              </button>
            </span>
          </h1>
          <p>本地处理视频或音频，输出完整逐字稿与带时间帧逐字稿。</p>
        </div>
      </div>

      <section className="transcription-panel">
        <div className="transcription-panel-heading">
          <div>
            <span className="eyebrow">LOCAL TRANSCRIPTION</span>
            <h2>本地音视频识别</h2>
          </div>
          <span className="transcription-model-badge">
            SenseVoice Small INT8
          </span>
        </div>
        <p className="muted">
          模型文件与任务结果独立保存在用户数据目录。需要安装模型时，可直接点击标题右侧的
          AI 图标和文档图标。
        </p>
        <div
          className={`transcription-import${dragging ? " is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (busy) return;
            const files = event.dataTransfer.files;
            if (files.length !== 1) {
              setError("请一次导入 1 个音视频文件。");
              return;
            }
            try {
              const path = window.aiVideo.filePath(files[0]);
              if (!path) {
                setError("无法读取拖入的文件，请点击选择文件。");
                return;
              }
              void choose(path);
            } catch {
              setError("无法读取拖入的文件，请点击选择文件。");
            }
          }}
        >
          {source ? (
            <>
              <div className="transcription-source">
                {source.kind === "video" ? (
                  <Film size={28} />
                ) : (
                  <Music size={28} />
                )}
                <div>
                  <strong title={source.path}>{source.name}</strong>
                  <p className="muted">
                    {source.kind === "video" ? "视频" : "音频"} ·{" "}
                    {source.name.split(".").pop()?.toUpperCase()} ·{" "}
                    {(source.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                    {Math.floor((source.duration || 0) / 60)}分
                    {Math.round((source.duration || 0) % 60)}秒
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="移除文件"
                  disabled={busy}
                  onClick={() => {
                    setSource(null);
                    setError("");
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void choose()}
              >
                更换文件
              </button>
            </>
          ) : (
            <>
              <Upload size={30} />
              <h3>导入 / 拖入视频或音频</h3>
              <p className="muted">
                MP4 · MOV · MKV · AVI · MP3 · WAV · M4A · AAC
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void choose()}
              >
                选择文件
              </button>
            </>
          )}
        </div>
        <div className="transcription-controls">
          <button
            type="button"
            className="primary"
            disabled={!source || busy}
            onClick={() => void start()}
          >
            开始转文字
          </button>
          {progress.busy && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void cancel()}
            >
              {pending ? "正在取消…" : "取消任务"}
            </button>
          )}
          <span className="muted">音视频仅在本机处理</span>
        </div>
        <div
          className={`transcription-status transcription-status-${progress.stage}`}
          role="status"
          aria-live="polite"
        >
          <strong>{TRANSCRIPTION_STAGE_LABELS[progress.stage]}</strong>
          {progress.detail && <span>{progress.detail}</span>}
          {progress.busy && <progress aria-label="转文字正在处理" />}
        </div>
        {error && (
          <p className="transcription-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {result && (
        <section className="transcription-panel transcription-results">
          <h2>转写结果</h2>
          <p className="muted">
            {result.source.name} · 已生成两份 TXT · 耗时{" "}
            {(result.elapsedMs / 1000).toFixed(1)} 秒
          </p>
          <div className="transcription-result-actions">
            <button type="button" onClick={() => void resultAction("full")}>
              查看完整逐字稿
            </button>
            <button type="button" onClick={() => void resultAction("timeline")}>
              查看时间帧逐字稿
            </button>
            <button
              type="button"
              onClick={() => void resultAction("full", true)}
            >
              复制完整逐字稿
            </button>
            <button
              type="button"
              onClick={() => void resultAction("timeline", true)}
            >
              复制时间帧逐字稿
            </button>
            <button type="button" onClick={() => void resultAction("folder")}>
              <FolderOpen size={16} /> 打开本次任务文件夹
            </button>
          </div>
          <pre className="transcription-preview">{result.fullText}</pre>
        </section>
      )}
    </section>
  );
}

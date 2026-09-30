import type { Task } from "../../shared/types.ts";
import { Modal } from "../components/common.tsx";
import { api, media, run, time, labels, money, useApp } from "../store.ts";
export function AudioTaskDetail({
  task: t,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const input = JSON.parse(String(t.snapshot.draft.params.audioRequest || "{}"));
  return (
    <Modal title={t.name} onClose={onClose}>
      <p>
        音频任务 · {labels[t.status]} · {money(t.cost)}
      </p>
      {t.outputPath && <audio controls src={media("output", t.id)} />}
      <p>
        {t.snapshot.model.name} · {t.snapshot.account.name}
      </p>
      {input.params?.seed != null && <p>Seed：{input.params.seed}</p>}
      <p>{time(t.createdAt)}</p>
      <p className="path">{t.outputPath || "文件尚未下载"}</p>
      {t.error && <p className="notice warning">{t.error}</p>}
      <blockquote>{t.snapshot.draft.prompt}</blockquote>
      <div className="actions">
        <button
          onClick={() =>
            void run(async () => {
              await api(
                "audio.draft.save",
                JSON.parse(String(t.snapshot.draft.params.audioRequest)),
              );
              useApp.getState().setPage("生成音频");
              onClose();
            })
          }
        >
          编辑 / 重新生成
        </button>
        {t.resultUrl && (
          <button
            disabled={t.status === "Downloading"}
            onClick={() =>
              void run(() => api("tasks.redownload", { id: t.id }))
            }
          >
            重新下载
          </button>
        )}
        {t.outputPath && (
          <button
            onClick={() =>
              void run(() => api("open", { taskId: t.id, folder: true }))
            }
          >
            打开文件位置
          </button>
        )}
        <button
          onClick={() =>
            void run(async () => {
              const removed = await api("tasks.remove", { id: t.id });
              if (removed) onClose();
            })
          }
        >
          删除任务
        </button>
      </div>
    </Modal>
  );
}

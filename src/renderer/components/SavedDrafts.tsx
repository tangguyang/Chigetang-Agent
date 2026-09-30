import { api, run, time, useApp } from "../store.ts";
export function SavedDrafts() {
  const state = useApp();
  return (
    <details className="saved-drafts">
      <summary>未提交任务 / 草稿（{state.drafts.length}）</summary>
      {state.drafts.map((d) => (
        <div className="saved-draft-row" key={d.id}>
          <button onClick={() => void run(() => state.openDraft(d.id))}>
            {d.name}
            <small>{time(d.updatedAt)}</small>
          </button>
          <button
            title="删除未提交任务"
            onClick={() =>
              void run(async () => {
                const removed = await api<boolean>("draft.remove", {
                  id: d.id,
                });
                if (!removed) return;
                if (useApp.getState().draft?.draftId === d.id) {
                  useApp.setState({ draft: null });
                  await state.newDraft();
                }
                await state.refreshDrafts();
              })
            }
          >
            删除
          </button>
        </div>
      ))}
    </details>
  );
}

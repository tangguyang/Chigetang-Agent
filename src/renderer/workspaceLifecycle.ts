export interface SubmittedWorkspaceLifecycle<T> {
  currentDraftId: () => string | undefined;
  cancelPendingSave: () => void;
  finishSubmitted: () => Promise<void>;
  afterFinish: () => void;
  createReplacement: () => Promise<T>;
  activateReplacement: (draft: T) => void;
  onFinishError: (error: unknown) => void;
  refreshDrafts: () => Promise<void>;
}

/**
 * Finalize one submitted workspace without ever taking ownership away from a
 * newer workspace the user switched to while async IPC was in flight.
 */
export async function completeSubmittedWorkspace<T>(
  submittedId: string,
  lifecycle: SubmittedWorkspaceLifecycle<T>,
) {
  if (lifecycle.currentDraftId() === submittedId) lifecycle.cancelPendingSave();

  try {
    await lifecycle.finishSubmitted();
  } catch (error) {
    lifecycle.onFinishError(error);
  }

  lifecycle.afterFinish();
  if (lifecycle.currentDraftId() === submittedId) {
    // A late edit may have scheduled another save while finishSubmitted awaited.
    lifecycle.cancelPendingSave();
    const replacement = await lifecycle.createReplacement();
    if (lifecycle.currentDraftId() === submittedId)
      lifecycle.activateReplacement(replacement);
  }

  await lifecycle.refreshDrafts();
}

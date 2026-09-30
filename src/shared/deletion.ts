import type { Task } from "./types.ts";
export function taskDeletionOptions(task: Task) {
  const cloud = Boolean(task.apiTaskId) || task.status === "Submitting";
  const active =
    cloud && !["Completed", "Failed", "Cancelled"].includes(task.status);
  const canCancel =
    active &&
    task.snapshot.model.adapter === "seedance" &&
    Boolean(task.apiTaskId);
  return {
    active,
    canCancel,
    message: "确定删除这个任务吗？",
    detail: active
      ? "删除本地任务记录不会停止云端计费/生成。素材和输出文件不会删除；本地仍会追踪已有云任务。"
      : "只删除任务记录，素材和输出文件保留。",
    buttons: canCancel
      ? ["返回", "仅删除记录", "请求云端取消并删除"]
      : ["返回", "删除记录"],
  };
}

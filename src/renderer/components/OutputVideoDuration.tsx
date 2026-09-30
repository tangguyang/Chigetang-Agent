import { useEffect, useState } from 'react';
import type { Task } from '../../shared/types.ts';
import { media } from '../store.ts';

/** Read only the local output's metadata. Never substitute requested duration. */
export function OutputVideoDuration({ task }: { task: Task }) {
  const isVideo = task.type ? task.type === 'video' || task.type === 'video-group' : task.snapshot.model.type === 'video';
  const readable = isVideo && Boolean(task.outputPath) && task.downloadStatus === 'completed';
  const [duration, setDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!readable || duration !== null || failed) return;
    const timer = setTimeout(() => setFailed(true), 15000);
    return () => clearTimeout(timer);
  }, [readable, duration, failed]);
  const label = !isVideo ? '非视频任务' : !readable
    ? task.downloadStatus === 'failed' ? '视频时长：下载失败' : task.status === 'Completed' ? '视频时长：等待下载' : '视频时长：待生成'
    : duration !== null ? `视频时长：${Number(duration.toFixed(2))}秒`
    : failed ? '视频时长：无法读取' : '视频时长：读取中…';
  return <>
    <small className="output-video-duration">{label}</small>
    {readable && duration === null && !failed && <video hidden muted preload="metadata"
      src={media('output', task.id)}
      onLoadedMetadata={event => {
        const seconds = event.currentTarget.duration;
        if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds);
        else setFailed(true);
      }} onError={() => setFailed(true)} />}
  </>;
}

import type { DownloadTask } from './types'

export type DownloadRetryDestination = 'downloads' | 'desktop'

/** Failed downloads return to their exact owning flow; the Download Center never retries itself. */
export function retryDestination(task: DownloadTask): DownloadRetryDestination | null {
  if (
    task.owner.namespace === 'chronicle'
    && task.owner.resourceType === 'model-resource'
  ) {
    return 'downloads'
  }
  if (
    task.owner.namespace === 'opencode'
    && task.owner.resourceType === 'runtime'
    && task.owner.resourceId === 'cli'
  ) {
    return 'downloads'
  }
  if (task.owner.namespace === 'desktop-update') {
    return 'desktop'
  }
  return null
}

/** Status labels describe lifecycle only; failed rows render their own error code and message. */
export function downloadStatusKey(task: DownloadTask):
  | 'download.status.cancelled'
  | 'download.status.completed'
  | 'download.status.downloading'
  | 'download.status.failed'
  | 'download.status.queued'
  | 'download.status.verifying' {
  const keys = {
    cancelled: 'download.status.cancelled',
    completed: 'download.status.completed',
    downloading: 'download.status.downloading',
    failed: 'download.status.failed',
    queued: 'download.status.queued',
    verifying: 'download.status.verifying',
  } as const
  return keys[task.status]
}

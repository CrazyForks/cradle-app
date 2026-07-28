import { openSettingsSection } from '~/navigation/navigation-commands'

import { retryDestination } from './presentation'
import type { DownloadTask } from './types'

export function openDownloadRetryDestination(task: DownloadTask): void {
  const destination = retryDestination(task)
  if (destination === 'downloads') {
    openSettingsSection(destination)
  }
  else if (destination === 'desktop') {
    openSettingsSection(destination)
  }
}

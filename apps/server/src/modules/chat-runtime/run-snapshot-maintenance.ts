import * as Maintenance from '../maintenance/service'
import { maintainRunSnapshots } from './run-snapshot'

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000

export function registerRunSnapshotMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'chat-runtime',
    key: 'maintain-run-snapshots',
    title: 'Maintain run snapshots',
    intervalMs: DEFAULT_INTERVAL_MS,
    runOnStart: true,
    manuallyRunnable: true,
    run: () => ({ ...maintainRunSnapshots() }),
  })
}

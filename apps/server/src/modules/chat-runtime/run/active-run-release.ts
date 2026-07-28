import { rejectPendingToolApprovalsForRun } from '../pending-tool-approval'
import { rejectPendingUserInputsForRun } from '../pending-user-input'
import type { ActiveRun } from '../run-registry'
import { runRegistry } from '../run-registry'
import { runSubscribers } from '../stream/live-run-streams'

export interface ActiveRunReleaseDeps {
  stopSnapshotTimer: (activeRun: ActiveRun) => void
  stopPendingRunDeltaFlush: (activeRun: ActiveRun) => void
}

export interface ActiveRunReleaseController {
  releaseActiveRunClaim: (activeRun: ActiveRun) => void
  disposeActiveRun: (activeRun: ActiveRun) => void
}

export function createActiveRunReleaseController(
  deps: ActiveRunReleaseDeps,
): ActiveRunReleaseController {
  function releaseActiveRunClaim(activeRun: ActiveRun): void {
    deps.stopSnapshotTimer(activeRun)
    deps.stopPendingRunDeltaFlush(activeRun)
    rejectPendingUserInputsForRun(
      activeRun.runId,
      new Error('Chat run ended before pending user input was submitted'),
    )
    rejectPendingToolApprovalsForRun(
      activeRun.runId,
      new Error('Chat run ended before pending tool approval was submitted'),
    )
    runRegistry.deleteActiveRun(activeRun.runId)
    if (runRegistry.getActiveRunIdForSession(activeRun.sessionId) === activeRun.runId) {
      runRegistry.deleteActiveRunIdForSession(activeRun.sessionId)
    }
  }

  function disposeActiveRun(activeRun: ActiveRun): void {
    runSubscribers.delete(activeRun.runId)
    activeRun.pendingDeltaChunk = null
    activeRun.pendingStreamingSnapshotMessageJson = null
    activeRun.lastStreamingSnapshotMessageJson = null
    activeRun.runChunkSequencer.clear()
    activeRun.snapshotEventIdByCoalesceKey.clear()
    activeRun.finalMessage.parts = []
    activeRun.finalProjection.activeTextParts.clear()
    activeRun.finalProjection.activeReasoningParts.clear()
    activeRun.finalProjection.partialToolCalls.clear()
  }

  return {
    releaseActiveRunClaim,
    disposeActiveRun,
  }
}

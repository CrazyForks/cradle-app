import type { RunChunkResumeToken } from '@cradle/chat-runtime-contracts'
import { createUIMessageStreamSnapshotChunk } from '@cradleapp/ai-sdk'

import { runRegistry } from '../run-registry'
import type {
  RunChunkReplay,
  SequencedRunChunkSubscriber,
} from './run-chunk-log'

export type SessionRunChunkSubscription
  = | { kind: 'not-found' }
    | { kind: 'recovery', runId: string, cursor: number, chunk: ReturnType<typeof createUIMessageStreamSnapshotChunk>, unsubscribe: () => void }
    | { kind: 'ready', replay: Extract<RunChunkReplay, { kind: 'ready' }>, unsubscribe: () => void }

export function openSessionRunChunkSubscription(
  sessionId: string,
  after: RunChunkResumeToken | undefined,
  subscriber: SequencedRunChunkSubscriber,
): SessionRunChunkSubscription {
  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    return { kind: 'not-found' }
  }
  const active = runRegistry.getActiveRun(runId)
  if (!active) {
    return { kind: 'not-found' }
  }

  const unsubscribe = active.runChunkLog.subscribe(subscriber)
  const replay = active.runChunkLog.replayAfter(after?.runId === runId ? after.cursor : undefined)
  if (replay.kind === 'snapshot-required') {
    const cursor = active.runChunkLog.readLatestCursor()
    return {
      kind: 'recovery',
      runId,
      cursor,
      chunk: createUIMessageStreamSnapshotChunk({
        runId,
        cursor,
        target: { message: active.finalMessage, state: active.finalProjection },
      }),
      unsubscribe,
    }
  }
  return { kind: 'ready', replay, unsubscribe }
}

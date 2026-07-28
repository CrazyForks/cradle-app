import type { RunChunkResumeToken } from '@cradle/chat-runtime-contracts'
import { createUIMessageStreamSnapshotChunk } from '@cradleapp/ai-sdk'

import { runRegistry } from '../run-registry'
import type { SequencedRunChunkSubscriber } from './run-chunk-sequencer'

export type SessionRunChunkSubscription
  = | { kind: 'not-found' }
    | { kind: 'recovery', runId: string, cursor: number, chunk: ReturnType<typeof createUIMessageStreamSnapshotChunk>, unsubscribe: () => void }

export function openSessionRunChunkSubscription(
  sessionId: string,
  _after: RunChunkResumeToken | undefined,
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

  const unsubscribe = active.runChunkSequencer.subscribe(subscriber)
  const cursor = active.runChunkSequencer.readLatestCursor()
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

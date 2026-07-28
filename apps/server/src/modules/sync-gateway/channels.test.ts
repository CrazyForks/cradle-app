import type { SyncServerDataFrame } from '@cradle/chat-runtime-contracts'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFinalMessageProjectionState,
  projectFinalMessageChunk,
} from '../chat-runtime/run/final-message-projection'
import type { ActiveRun } from '../chat-runtime/run-registry'
import { runRegistry } from '../chat-runtime/run-registry'
import { createRunChunkSequencer } from '../chat-runtime/stream/run-chunk-sequencer'
import { attachSyncSubscription } from './channels'

function createActiveRun(): ActiveRun {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    messageId: 'message-1',
    startedAtSeconds: 0,
    providerTargetKind: null,
    providerTargetId: null,
    runtime: {} as ActiveRun['runtime'],
    runtimeSession: {
      id: 'runtime-session-1',
      chatSessionId: 'session-1',
      providerTargetId: null,
      runtimeKind: 'standard',
      providerSessionId: null,
      providerStateSnapshot: null,
    },
    modelId: null,
    runChunkSequencer: createRunChunkSequencer('run-1'),
    pendingDeltaChunk: null,
    pendingDeltaFlushTimer: null,
    snapshotTimer: null,
    finalMessage: { id: 'message-1', role: 'assistant', parts: [] },
    finalProjection: createFinalMessageProjectionState(),
    runtimeSettings: {} as ActiveRun['runtimeSettings'],
    usageEventCount: 0,
    usageEventAggregate: null,
    runSnapshotSeq: 0,
    snapshotEventIdByCoalesceKey: new Map(),
    runSnapshotDroppedEventCount: 0,
  }
}

function publish(run: ActiveRun, chunk: UIMessageChunk): void {
  projectFinalMessageChunk(run, chunk)
  run.runChunkSequencer.publish(chunk, false)
}

afterEach(() => {
  runRegistry.clearAll()
})

describe('run chunk sync recovery', () => {
  it('bootstraps from a current snapshot and continues with live chunks', () => {
    const run = createActiveRun()
    publish(run, { type: 'start', messageId: run.messageId })
    publish(run, { type: 'text-start', id: 'text-1' })
    publish(run, { type: 'text-delta', id: 'text-1', delta: 'before ' })
    runRegistry.setActiveRun(run.runId, run)
    runRegistry.setActiveRunIdForSession(run.sessionId, run.runId)

    const frames: SyncServerDataFrame[] = []
    const end = vi.fn()
    const unsubscribe = attachSyncSubscription({
      op: 'sub',
      subId: 'sub-1',
      channel: 'run-chunks',
      sessionId: run.sessionId,
    }, {
      send: frame => frames.push(frame),
      end,
    })

    expect(frames).toMatchObject([
      {
        kind: 'chunk',
        runId: run.runId,
        cursor: 2,
        replay: true,
        terminal: false,
        chunk: {
          type: 'data-cradle-stream-snapshot',
          transient: true,
          data: {
            runId: run.runId,
            cursor: 2,
            snapshot: {
              message: {
                id: run.messageId,
                parts: [{ type: 'text', text: 'before ', state: 'streaming' }],
              },
              activeTextParts: [{ id: 'text-1', partIndex: 0 }],
            },
          },
        },
      },
      {
        kind: 'sub-ack',
        channel: 'run-chunks',
        runId: run.runId,
        cursor: 2,
      },
    ])
    expect(end).not.toHaveBeenCalled()

    publish(run, { type: 'text-delta', id: 'text-1', delta: 'after' })

    expect(frames.at(-1)).toMatchObject({
      kind: 'chunk',
      runId: run.runId,
      cursor: 3,
      replay: false,
      terminal: false,
      chunk: { type: 'text-delta', id: 'text-1', delta: 'after' },
    })
    expect(end).not.toHaveBeenCalledWith('snapshot-required')
    unsubscribe()
  })
})

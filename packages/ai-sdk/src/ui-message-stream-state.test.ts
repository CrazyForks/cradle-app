import type { UIMessage, UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  applyUIMessageChunk,
  createUIMessageStreamSnapshotChunk,
  createUIMessageStreamState,
  exportUIMessageStreamSnapshot,
  isUIMessageStreamSnapshotChunk,
  restoreUIMessageStreamSnapshot,
} from './ui-message-stream-state'

function createTarget(messageId = 'message-1') {
  return {
    message: { id: messageId, role: 'assistant', parts: [] } satisfies UIMessage,
    state: createUIMessageStreamState(),
  }
}

describe('ui message stream state', () => {
  it('restores active text and partial tool input before consuming later deltas', () => {
    const uninterrupted = createTarget()
    const prefix: UIMessageChunk[] = [
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'hello' },
      { type: 'tool-input-start', toolCallId: 'tool-1', toolName: 'shell' },
      { type: 'tool-input-delta', toolCallId: 'tool-1', inputTextDelta: '{"cmd":"pnpm' },
    ]
    for (const chunk of prefix) {
      applyUIMessageChunk(uninterrupted, chunk)
    }

    const restored = restoreUIMessageStreamSnapshot(exportUIMessageStreamSnapshot(uninterrupted))
    const suffix: UIMessageChunk[] = [
      { type: 'text-delta', id: 'text-1', delta: ' world' },
      { type: 'text-end', id: 'text-1' },
      { type: 'tool-input-delta', toolCallId: 'tool-1', inputTextDelta: ' test"}' },
      {
        type: 'tool-input-available',
        toolCallId: 'tool-1',
        toolName: 'shell',
        input: { cmd: 'pnpm test' },
      },
      { type: 'tool-output-available', toolCallId: 'tool-1', output: { exitCode: 0 } },
    ]
    for (const chunk of suffix) {
      applyUIMessageChunk(uninterrupted, chunk)
      applyUIMessageChunk(restored, chunk)
    }

    expect(restored.message).toEqual(uninterrupted.message)
  })

  it('encodes recovery as a transient AI SDK data chunk', () => {
    const target = createTarget()
    applyUIMessageChunk(target, { type: 'text-start', id: 'text-1' })
    applyUIMessageChunk(target, { type: 'text-delta', id: 'text-1', delta: 'partial' })

    const chunk = createUIMessageStreamSnapshotChunk({ runId: 'run-1', cursor: 42, target })

    expect(isUIMessageStreamSnapshotChunk(chunk)).toBe(true)
    expect(chunk).toMatchObject({
      type: 'data-cradle-stream-snapshot',
      transient: true,
      data: { runId: 'run-1', cursor: 42 },
    })
  })
})

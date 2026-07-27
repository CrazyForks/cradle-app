import { describe, expect, it } from 'vitest'

import { hasCompleteCurrentCodexNativeHistory } from './state-projector'

function snapshot(codex: Record<string, unknown>): string {
  return JSON.stringify({
    workspacePath: '/tmp/workspace',
    models: { currentModelId: null },
    codex,
  })
}

describe('hasCompleteCurrentCodexNativeHistory', () => {
  it('accepts a complete empty current history for the resumed thread', () => {
    expect(hasCompleteCurrentCodexNativeHistory(snapshot({
      nativeHistory: {
        threadId: 'thread-1',
        itemsView: 'full',
        fetchedAt: 1,
        complete: true,
        turns: [],
        turnCount: 0,
        itemCount: 0,
        nextCursor: null,
        error: null,
      },
    }), 'thread-1')).toBe(true)
  })

  it('rejects stale previous, incomplete, errored, and different-thread histories', () => {
    const complete = {
      threadId: 'thread-1',
      itemsView: 'full',
      fetchedAt: 1,
      complete: true,
      turns: [],
      turnCount: 0,
      itemCount: 0,
      nextCursor: null,
      error: null,
    }
    expect(hasCompleteCurrentCodexNativeHistory(snapshot({
      previousNativeHistory: complete,
    }), 'thread-1')).toBe(false)
    expect(hasCompleteCurrentCodexNativeHistory(snapshot({
      nativeHistory: { ...complete, complete: false },
    }), 'thread-1')).toBe(false)
    expect(hasCompleteCurrentCodexNativeHistory(snapshot({
      nativeHistory: { ...complete, error: 'failed to list turns' },
    }), 'thread-1')).toBe(false)
    expect(hasCompleteCurrentCodexNativeHistory(snapshot({
      nativeHistory: complete,
    }), 'thread-2')).toBe(false)
  })
})

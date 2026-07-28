import { describe, expect, it, vi } from 'vitest'

import { createRunChunkSequencer } from './run-chunk-sequencer'

describe('run chunk sequencer', () => {
  it('assigns monotonic cursors through terminal publication', () => {
    const sequencer = createRunChunkSequencer('run-1')

    expect(sequencer.readLatestCursor()).toBe(-1)
    expect(sequencer.publish({ type: 'start', messageId: 'message-1' }, false))
      .toMatchObject({ runId: 'run-1', cursor: 0, terminal: false })
    expect(sequencer.publish({ type: 'finish', finishReason: 'stop' }, true))
      .toMatchObject({ runId: 'run-1', cursor: 1, terminal: true })
    expect(sequencer.readLatestCursor()).toBe(1)
    expect(() => sequencer.publish({ type: 'abort' }, true)).toThrow(
      'Cannot publish to terminal run chunk sequencer run-1',
    )
  })

  it('fans out each live publication once and isolates throwing subscribers', () => {
    const sequencer = createRunChunkSequencer('run-1')
    const healthy = vi.fn()
    const throwing = vi.fn(() => {
      throw new Error('subscriber failed')
    })
    const unsubscribe = sequencer.subscribe(healthy)
    sequencer.subscribe(throwing)

    const first = sequencer.publish({ type: 'start', messageId: 'message-1' }, false)
    const second = sequencer.publish({ type: 'text-start', id: 'text-1' }, false)

    expect(healthy).toHaveBeenNthCalledWith(1, first)
    expect(healthy).toHaveBeenNthCalledWith(2, second)
    expect(throwing).toHaveBeenCalledOnce()
    unsubscribe()
    sequencer.publish({ type: 'finish', finishReason: 'stop' }, true)
    expect(healthy).toHaveBeenCalledTimes(2)
  })

  it('clears subscribers on terminal publication', () => {
    const sequencer = createRunChunkSequencer('run-1')
    const subscriber = vi.fn()
    sequencer.subscribe(subscriber)

    sequencer.publish({ type: 'finish', finishReason: 'stop' }, true)
    sequencer.subscribe(subscriber)

    expect(subscriber).toHaveBeenCalledOnce()
  })

  it('records scalar publication diagnostics without exposing replay history', () => {
    const sequencer = createRunChunkSequencer('run-1')
    sequencer.publish({ type: 'text-delta', id: 'text-1', delta: 'hello' }, false)
    sequencer.publish({ type: 'reasoning-delta', id: 'reasoning-1', delta: 'reasoning' }, false)
    sequencer.publish({
      type: 'tool-input-delta',
      toolCallId: 'tool-1',
      inputTextDelta: '{"query":"large"}',
    }, false)
    for (let index = 0; index < 100; index += 1) {
      sequencer.publish({
        type: 'tool-output-available',
        toolCallId: 'tool-1',
        output: { index, payload: 'large output' },
      }, false)
    }

    expect(sequencer.readPublicationSummary()).toEqual({
      latestCursor: 102,
      publishedChunkCount: 103,
      textDeltaCount: 1,
      reasoningDeltaCount: 1,
      toolInputDeltaCount: 1,
      toolOutputCount: 100,
      maxDeltaChars: 17,
    })
    expect(Object.keys(sequencer).sort()).toEqual([
      'clear',
      'publish',
      'readLatestCursor',
      'readPublicationSummary',
      'runId',
      'subscribe',
    ])
  })
})

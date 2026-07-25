import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  groupMessagePartRefs,
  groupMessageParts,
  splitExecutionPhase,
  splitSegmentExecutionPhase,
} from './chat-render-plan'

describe('groupMessageParts', () => {
  it('keeps runtime warnings between streamed text segments', () => {
    const parts = [
      { type: 'text', text: 'Before', state: 'done' },
      {
        type: 'data-runtime-warning',
        data: {
          message: 'Reconnecting... 2/5',
          additionalDetails: 'request timed out',
        },
      },
      { type: 'text', text: 'After', state: 'done' },
    ] as UIMessage['parts']

    const items = groupMessageParts({
      parts,
      messageId: 'message-1',
      describeToolKind: () => null,
    })

    expect(items.map(item => item.kind)).toEqual(['text', 'runtime-warning', 'text'])
  })
})

describe('splitExecutionPhase', () => {
  it('folds intermediate narration and tools behind the final text', () => {
    const parts = [
      { type: 'text', text: 'I will inspect this.', state: 'done' },
      { type: 'tool-test', toolCallId: 'tool-1', state: 'output-available', input: {}, output: {} },
      { type: 'text', text: 'Still working…', state: 'done' },
      { type: 'tool-test', toolCallId: 'tool-2', state: 'output-available', input: {}, output: {} },
      { type: 'text', text: 'The inspection is complete.', state: 'done' },
    ] as UIMessage['parts']
    const items = groupMessageParts({
      parts,
      messageId: 'message-1',
      describeToolKind: () => 'terminal',
    })

    const split = splitExecutionPhase(items, { describeToolKind: () => 'terminal' })
    expect(split).not.toBeNull()
    expect(split!.finalItems.map(item => item.kind)).toEqual(['text'])
    expect(split!.finalItems[0]).toMatchObject({
      kind: 'text',
      text: 'The inspection is complete.',
    })
    expect(split!.executionItems.map(item => item.kind)).toEqual([
      'text',
      'tool-call',
      'text',
      'tool-call',
    ])
  })

  it('does not fold text-only messages without execution tools', () => {
    const parts = [
      { type: 'text', text: 'First thought.', state: 'done' },
      { type: 'text', text: 'Second thought.', state: 'done' },
    ] as UIMessage['parts']
    const items = groupMessageParts({
      parts,
      messageId: 'message-1',
      describeToolKind: () => null,
    })

    expect(splitExecutionPhase(items, { describeToolKind: () => null })).toBeNull()
  })

  it('keeps plan tools with the final reply', () => {
    const parts = [
      { type: 'tool-test', toolCallId: 'tool-1', state: 'output-available', input: {}, output: {} },
      { type: 'tool-plan', toolCallId: 'plan-1', state: 'output-available', input: {}, output: {} },
      { type: 'text', text: 'Here is the plan summary.', state: 'done' },
    ] as UIMessage['parts']
    const items = groupMessageParts({
      parts,
      messageId: 'message-1',
      describeToolKind: (part) => {
        if (part.type === 'tool-plan') {
          return 'plan'
        }
        return 'terminal'
      },
    })

    const split = splitExecutionPhase(items, {
      describeToolKind: (part) => {
        if (part.type === 'tool-plan') {
          return 'plan'
        }
        return 'terminal'
      },
    })
    expect(split).not.toBeNull()
    expect(split!.executionItems.map(item => item.kind)).toEqual(['tool-call'])
    expect(split!.finalItems.map(item => item.kind)).toEqual(['tool-call', 'text'])
  })
})

describe('splitSegmentExecutionPhase', () => {
  it('mirrors item split for interleaved assistant turns', () => {
    const parts = [
      { type: 'text', text: 'Checking…', state: 'done' },
      { type: 'tool-test', toolCallId: 'tool-1', state: 'output-available', input: {}, output: {} },
      { type: 'text', text: 'Done.', state: 'done' },
    ] as UIMessage['parts']
    const segments = groupMessagePartRefs({
      parts,
      messageId: 'message-1',
      describeToolKind: () => 'terminal',
    })

    const split = splitSegmentExecutionPhase(segments, { describeToolKind: () => 'terminal' })
    expect(split).not.toBeNull()
    expect(split!.finalItems).toHaveLength(1)
    expect(split!.finalItems[0]).toMatchObject({ kind: 'text', hasText: true })
    expect(split!.executionItems.map(item => item.kind)).toEqual(['text', 'tool-call'])
  })
})

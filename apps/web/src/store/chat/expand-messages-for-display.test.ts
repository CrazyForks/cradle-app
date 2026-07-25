import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  applyPartsProjection,
  expandMessagesForDisplay,
} from './expand-messages-for-display'

function steerUser(input: {
  id: string
  sourceMessageId: string
  splitText: string
  text?: string
}): UIMessage {
  return {
    id: input.id,
    role: 'user',
    parts: [{ type: 'text', text: input.text ?? 'Please adjust.' }],
    metadata: {
      cradle: {
        continuation: {
          mode: 'steer',
          queueItemId: input.id,
          sourceMessageId: input.sourceMessageId,
          splitParts: [{ type: 'text', text: input.splitText }],
        },
      },
    },
  } as UIMessage
}

describe('expandMessagesForDisplay', () => {
  it('passes through messages without steer metadata', () => {
    const rows = expandMessagesForDisplay([
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
    ])
    expect(rows).toEqual([
      { rowKey: 'user-1', messageId: 'user-1', partsProjection: null, allowStreaming: true },
      { rowKey: 'assistant-1', messageId: 'assistant-1', partsProjection: null, allowStreaming: true },
    ])
  })

  it('expands a steered assistant into head, steer user, and streaming tail rows', () => {
    const rows = expandMessagesForDisplay([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      steerUser({
        id: 'steer-1',
        sourceMessageId: 'assistant-1',
        splitText: 'Before steer.',
      }),
    ])

    expect(rows.map(row => ({
      rowKey: row.rowKey,
      messageId: row.messageId,
      allowStreaming: row.allowStreaming,
      projectionType: row.partsProjection?.type ?? null,
    }))).toEqual([
      {
        rowKey: 'assistant-1#steer-head-steer-1',
        messageId: 'assistant-1',
        allowStreaming: false,
        projectionType: 'fixed',
      },
      {
        rowKey: 'steer-1',
        messageId: 'steer-1',
        allowStreaming: true,
        projectionType: null,
      },
      {
        rowKey: 'assistant-1#steer-tail-steer-1',
        messageId: 'assistant-1',
        allowStreaming: true,
        projectionType: 'tail',
      },
    ])

    const head = applyPartsProjection(
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      rows[0]!.partsProjection,
    )
    const tail = applyPartsProjection(
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      rows[2]!.partsProjection,
    )
    expect(head.parts).toEqual([{ type: 'text', text: 'Before steer.' }])
    expect(tail.parts).toEqual([{ type: 'text', text: ' After steer.' }])
  })

  it('ignores legacy :steer-tail ids if they still appear in store input', () => {
    const rows = expandMessagesForDisplay([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Before steer. After steer.' }],
      },
      steerUser({
        id: 'steer-1',
        sourceMessageId: 'assistant-1',
        splitText: 'Before steer.',
      }),
      {
        id: 'assistant-1:steer-tail',
        role: 'assistant',
        parts: [{ type: 'text', text: ' After steer.' }],
      },
    ])
    expect(rows.some(row => row.messageId.includes(':steer-tail'))).toBe(false)
    expect(rows.map(row => row.rowKey)).toEqual([
      'assistant-1#steer-head-steer-1',
      'steer-1',
      'assistant-1#steer-tail-steer-1',
    ])
  })
})

import type { QueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { hydrateChatMessageShells } from './hydrate-chat-message-shells'

describe('hydrateChatMessageShells', () => {
  it('replaces every history shell before returning', async () => {
    const details = new Map<string, UIMessage>([
      ['a', {
        id: 'a',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'full a' },
          { type: 'tool-test', toolCallId: 'tool-a', state: 'output-available', input: {}, output: {} },
        ],
      }],
      ['b', {
        id: 'b',
        role: 'user',
        parts: [{ type: 'text', text: 'full b' }],
      }],
    ])

    const fetchQuery = vi.fn(async (options: { queryKey: readonly unknown[] }) => {
      const match = JSON.stringify(options.queryKey).match(/"messageId":"([^"]+)"/)
      const messageId = match?.[1]
      if (!messageId || !details.has(messageId)) {
        throw new Error(`unexpected message detail request: ${JSON.stringify(options.queryKey)}`)
      }
      return { message: details.get(messageId) }
    })
    const queryClient = { fetchQuery } as unknown as QueryClient

    const shells: UIMessage[] = [
      {
        id: 'a',
        role: 'assistant',
        parts: [{ type: 'text', text: 'preview a' }],
        metadata: { cradle: { historyShell: true } },
      },
      {
        id: 'live',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'already full' },
          { type: 'tool-test', toolCallId: 't1', state: 'output-available', input: {}, output: {} },
        ],
      },
      {
        id: 'b',
        role: 'user',
        parts: [{ type: 'text', text: 'preview b' }],
        metadata: { cradle: { historyShell: true } },
      },
    ]

    const result = await hydrateChatMessageShells(queryClient, 'session-1', shells)
    expect(result[0]).toEqual(details.get('a'))
    expect(result[1]).toEqual(shells[1])
    expect(result[2]).toEqual(details.get('b'))
    expect(fetchQuery).toHaveBeenCalledTimes(2)
  })

  it('keeps unresolved shells when a detail fetch fails', async () => {
    const fetchQuery = vi.fn(async (options: { queryKey: readonly unknown[] }) => {
      const match = JSON.stringify(options.queryKey).match(/"messageId":"([^"]+)"/)
      const messageId = match?.[1]
      if (messageId === 'ok') {
        return {
          message: {
            id: 'ok',
            role: 'assistant',
            parts: [{ type: 'text', text: 'full' }],
          },
        }
      }
      throw new Error('detail failed')
    })
    const queryClient = { fetchQuery } as unknown as QueryClient
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const shells: UIMessage[] = [
      {
        id: 'ok',
        role: 'assistant',
        parts: [{ type: 'text', text: 'preview ok' }],
        metadata: { cradle: { historyShell: true } },
      },
      {
        id: 'bad',
        role: 'assistant',
        parts: [{ type: 'text', text: 'preview bad' }],
        metadata: { cradle: { historyShell: true } },
      },
    ]

    const result = await hydrateChatMessageShells(queryClient, 'session-1', shells)
    expect(result[0]).toEqual({
      id: 'ok',
      role: 'assistant',
      parts: [{ type: 'text', text: 'full' }],
    })
    expect(result[1]).toEqual(shells[1])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

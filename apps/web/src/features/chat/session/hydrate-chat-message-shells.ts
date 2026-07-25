import type { QueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'

import { chatMessageDetailQueryOptions } from '../api/messages'
import { isChatMessageShell } from './use-chat-session-types'

/**
 * Resolve every history shell to a full UIMessage before the transcript store paints.
 * The list API stays lightweight; callers must await this and commit once so text+tools
 * appear together instead of flashing preview text first.
 */
export async function hydrateChatMessageShells(
  queryClient: QueryClient,
  sessionId: string,
  messages: UIMessage[],
): Promise<UIMessage[]> {
  const shellEntries = messages.flatMap((message, index) => (
    isChatMessageShell(message) ? [{ index, messageId: message.id }] : []
  ))
  if (shellEntries.length === 0) {
    return messages
  }

  const settled = await Promise.allSettled(shellEntries.map(async ({ messageId }) => {
    const detail = await queryClient.fetchQuery(chatMessageDetailQueryOptions(sessionId, messageId))
    const next = detail.message
    if (next.role !== 'user' && next.role !== 'assistant') {
      throw new Error(`Unsupported chat message role for hydration: ${String(next.role)}`)
    }
    return next as UIMessage
  }))

  const nextMessages = messages.slice()
  settled.forEach((result, offset) => {
    if (result.status !== 'fulfilled') {
      console.warn(
        '[hydrateChatMessageShells] failed to hydrate message detail',
        shellEntries[offset]?.messageId,
        result.reason,
      )
      return
    }
    nextMessages[shellEntries[offset].index] = result.value
  })
  return nextMessages
}

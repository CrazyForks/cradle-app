import { createContext, useContext } from 'react'

import type { MessagePart } from '~/store/chat/types'

/** When set, part-by-id readers index into these parts instead of the store message. */
export const MessageDisplayPartsContext = createContext<MessagePart[] | null>(null)

export function useMessageDisplayParts(): MessagePart[] | null {
  return useContext(MessageDisplayPartsContext)
}

/**
 * Prefer projected display parts (steer head/mid/tail) when the bubble provides them.
 * `undefined` means no projection context — fall back to the store.
 */
export function useMessagePartAt(partIndex: number): MessagePart | null | undefined {
  const displayParts = useMessageDisplayParts()
  if (!displayParts) {
    return undefined
  }
  return displayParts[partIndex] ?? null
}

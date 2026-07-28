import { RuntimeWarningBlock } from '../../rendering/blocks/runtime-warning-block'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readRuntimeWarningPartFromState } from '../../rendering/message-bubble-selectors'
import { isRuntimeWarningMessagePart } from '../../runtime-warning'
import { useMessagePartAt } from '../lib/message-display-parts-context'

export interface MessageRuntimeWarningPartByIdProps { sessionId: string, messageId: string, partIndex: number }

export function MessageRuntimeWarningPartById({ sessionId, messageId, partIndex }: MessageRuntimeWarningPartByIdProps) {
  const displayPart = useMessagePartAt(partIndex)
  const storePart = useChatRenderStore((state) => {
    if (displayPart !== undefined) {
      return null
    }
    return readRuntimeWarningPartFromState(state, sessionId, messageId, partIndex)
  })
  const part = displayPart != null
    ? (isRuntimeWarningMessagePart(displayPart) ? displayPart : null)
    : storePart ?? undefined
  return part ? <RuntimeWarningBlock warning={part.data} /> : null
}

import { ReasoningBlock } from '../../rendering/blocks/reasoning-block'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { areReasoningPartsEqual, readReasoningPartFromState } from '../../rendering/message-bubble-selectors'
import { useMessagePartAt } from '../lib/message-display-parts-context'

export interface MessageReasoningPartByIdProps { sessionId: string, messageId: string, partIndex: number, isActiveStreamingSegment: boolean }

export function MessageReasoningPartById({ sessionId, messageId, partIndex, isActiveStreamingSegment }: MessageReasoningPartByIdProps) {
  const displayPart = useMessagePartAt(partIndex)
  const storePart = useChatRenderStore((state) => {
    if (displayPart !== undefined) {
      return { text: '', state: 'done' as const }
    }
    return readReasoningPartFromState(state, sessionId, messageId, partIndex)
  }, areReasoningPartsEqual)
  const part = displayPart !== undefined
    ? (
        displayPart?.type === 'reasoning'
          ? {
              text: displayPart.text,
              state: (displayPart as { state?: 'streaming' | 'done' }).state,
            }
          : { text: '', state: 'done' as const }
      )
    : storePart
  return <ReasoningBlock text={part.text} state={isActiveStreamingSegment && part.state === 'streaming' ? 'streaming' : 'done'} />
}

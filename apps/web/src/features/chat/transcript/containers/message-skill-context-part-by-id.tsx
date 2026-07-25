import { isChatSkillContextPart } from '../../context/chat-context-parts'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readSkillContextPartFromState } from '../../rendering/message-bubble-selectors'
import { useMessagePartAt } from '../lib/message-display-parts-context'
import { SkillContextView } from '../views/skill-context-view'

export interface MessageSkillContextPartByIdProps { sessionId: string, messageId: string, partIndex: number }

export function MessageSkillContextPartById({ sessionId, messageId, partIndex }: MessageSkillContextPartByIdProps) {
  const displayPart = useMessagePartAt(partIndex)
  const storePart = useChatRenderStore((state) => {
    if (displayPart !== undefined) {
      return null
    }
    return readSkillContextPartFromState(state, sessionId, messageId, partIndex)
  })
  const part = displayPart !== undefined
    ? (isChatSkillContextPart(displayPart) ? displayPart : null)
    : storePart
  return part ? <SkillContextView part={part} /> : null
}

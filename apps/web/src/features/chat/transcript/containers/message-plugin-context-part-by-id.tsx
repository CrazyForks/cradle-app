import { isChatPluginContextPart } from '../../context/chat-context-parts'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readPluginContextPartFromState } from '../../rendering/message-bubble-selectors'
import { useMessagePartAt } from '../lib/message-display-parts-context'
import { PluginContextView } from '../views/plugin-context-view'

export interface MessagePluginContextPartByIdProps { sessionId: string, messageId: string, partIndex: number }

export function MessagePluginContextPartById({ sessionId, messageId, partIndex }: MessagePluginContextPartByIdProps) {
  const displayPart = useMessagePartAt(partIndex)
  const storePart = useChatRenderStore((state) => {
    if (displayPart !== undefined) {
      return null
    }
    return readPluginContextPartFromState(state, sessionId, messageId, partIndex)
  })
  const part = displayPart !== undefined
    ? (isChatPluginContextPart(displayPart) ? displayPart : null)
    : storePart
  return part ? <PluginContextView part={part} /> : null
}

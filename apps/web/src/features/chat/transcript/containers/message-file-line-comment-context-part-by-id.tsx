import { isChatFileLineCommentContextPart } from '../../context/chat-context-parts'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readFileLineCommentContextPartFromState } from '../../rendering/message-bubble-selectors'
import { useMessagePartAt } from '../lib/message-display-parts-context'
import { FileLineCommentContextView } from '../views/file-line-comment-context-view'

export interface MessageFileLineCommentContextPartByIdProps { sessionId: string, messageId: string, partIndex: number }

export function MessageFileLineCommentContextPartById({ sessionId, messageId, partIndex }: MessageFileLineCommentContextPartByIdProps) {
  const displayPart = useMessagePartAt(partIndex)
  const storePart = useChatRenderStore((state) => {
    if (displayPart !== undefined) {
      return null
    }
    return readFileLineCommentContextPartFromState(state, sessionId, messageId, partIndex)
  })
  const part = displayPart !== undefined
    ? (isChatFileLineCommentContextPart(displayPart) ? displayPart : null)
    : storePart
  return part ? <FileLineCommentContextView part={part} /> : null
}

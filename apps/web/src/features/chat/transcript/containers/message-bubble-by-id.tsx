import { chatSelectors } from '~/store/chat'

import { useChatRenderStore } from '../../rendering/chat-render-store'
import {
  areMessageFramesEqual,
  areMessageImageAttachmentsEqual,
  areRenderSegmentsEqual,
  readMessageFrameFromState,
  readMessageFromState,
  readMessageImageAttachmentsFromState,
  readRenderSegmentsFromState,
} from '../../rendering/message-bubble-selectors'
import { isChatMessageShell } from '../../session/use-chat-session-types'
import type { MessageBubbleByIdProps } from '../lib/message-bubble-types'
import { MessageBubbleSegmentsContainer } from './message-bubble-segments-container'

/** Bounded store subscription that adapts a message ID into the runtime bubble renderer. */
export function MessageBubbleById({
  sessionId,
  messageId,
  onToolApprovalResponse,
  editAction,
  textTransform,
}: MessageBubbleByIdProps) {
  const storeSessionId = sessionId ?? ''
  const isShell = useChatRenderStore((state) => {
    const message = readMessageFromState(state, storeSessionId, messageId)
    return message ? isChatMessageShell(message) : false
  })
  const frame = useChatRenderStore(state => readMessageFrameFromState(state, storeSessionId, messageId, textTransform), areMessageFramesEqual)
  const segments = useChatRenderStore(state => readRenderSegmentsFromState(state, storeSessionId, messageId, textTransform), areRenderSegmentsEqual)
  const isStreaming = useChatRenderStore(chatSelectors.isVisibleStreamingMessage(storeSessionId, messageId), (a, b) => a === b)
  const imageAttachments = useChatRenderStore(state => readMessageImageAttachmentsFromState(state, storeSessionId, segments), areMessageImageAttachmentsEqual)

  // History shells are text previews only. Never paint them — the session driver
  // batch-hydrates the loaded page, then commits full messages in one store write.
  if (!frame || isShell) {
    return null
  }
  return (
    <MessageBubbleSegmentsContainer
      sessionId={storeSessionId}
      frame={frame}
      segments={segments}
      isStreaming={isStreaming}
      imageAttachments={imageAttachments}
      onToolApprovalResponse={onToolApprovalResponse}
      editAction={editAction}
      textTransform={textTransform}
    />
  )
}

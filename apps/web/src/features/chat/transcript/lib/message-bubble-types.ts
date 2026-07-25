import type { MessagePartsProjection } from '~/store/chat/expand-messages-for-display'

import type { MessageTextTransform } from '../../rendering/message-bubble-selectors'
import type { MessageBubbleEditAction } from '../views/message-bubble-actions-view'

export interface MessageToolApprovalResponse {
  messageId: string
  approvalId: string
  approved: boolean
}

export type MessageToolApprovalHandler = (response: MessageToolApprovalResponse) => void

export interface MessageBubbleByIdProps {
  sessionId: string | null
  messageId: string
  /** View-only parts cut for steer head/mid/tail rows. Store message stays canonical. */
  partsProjection?: MessagePartsProjection | null
  /** Head/mid rows share the streaming assistant id but must not show streaming chrome. */
  allowStreaming?: boolean
  onToolApprovalResponse?: MessageToolApprovalHandler
  editAction?: MessageBubbleEditAction
  textTransform?: MessageTextTransform
}

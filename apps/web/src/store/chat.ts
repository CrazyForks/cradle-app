// This file is kept for backwards compatibility — all code lives in ./chat/
export type { ChatDisplayRow, MessagePartsProjection } from './chat/expand-messages-for-display'
export { chatSelectors, createChatStore, getChatStoreTelemetrySnapshot, useChatStore } from './chat/store'
export type {
  AssistantDisplaySplit,
  ChatActiveGoal,
  ChatActiveGoalStatus,
  ChatError,
  ChatRunDisplayMeta,
  ChatRunState,
  ChatState,
  MessageReconcileChange,
  PassiveRunStateInput,
  PublicStatus,
} from './chat/types'

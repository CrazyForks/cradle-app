// Public API — same exports as before
export type { ChatDisplayRow, MessagePartsProjection } from './expand-messages-for-display'
export { chatSelectors, createChatStore, getChatStoreTelemetrySnapshot, useChatStore } from './store'
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
} from './types'

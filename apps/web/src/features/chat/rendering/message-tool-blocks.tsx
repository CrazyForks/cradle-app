import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { useSessionBinding } from '../session/use-session-binding'
import { GroupedToolCallBlock } from '../tool-blocks/containers/grouped-tool-call-block-container'
import { ToolCallBlock } from '../tool-blocks/containers/tool-call-block-container'
import { useMessageDisplayParts, useMessagePartAt } from '../transcript/lib/message-display-parts-context'
import { readRenderableToolPart } from './chat-render-plan'
import { useChatRenderStore } from './chat-render-store'
import { toolNameFromPart } from './chat-tool-entities'
import {
  areGroupedRenderableToolItemsEqual,
  areRenderableToolPartsEqual,
  readRenderableToolPartFromState,
  readToolApproval,
} from './message-bubble-selectors'
import type { describeToolCall, RenderableToolPart } from './tool-ui-classifier'

export type MessageToolApprovalHandler = (response: {
  messageId: string
  approvalId: string
  approved: boolean
}) => void

export function ToolCallBlockFromPart({
  messageId,
  part,
  onToolApprovalResponse,
  children,
  animated,
  sessionId,
  workspaceDiffTarget,
}: {
  messageId: string
  part: RenderableToolPart
  onToolApprovalResponse?: MessageToolApprovalHandler
  children?: ReactNode
  animated?: boolean
  sessionId?: string | null
  workspaceDiffTarget?: { workspaceId: string, ownerId?: string | null }
}) {
  const approval = readToolApproval(part)

  return (
    <ToolCallBlock
      toolName={toolNameFromPart(part)}
      toolCallId={part.toolCallId}
      state={part.state}
      approval={approval}
      argumentsText={part.argumentsText}
      input={part.input}
      output={part.output}
      errorText={part.errorText}
      animated={animated}
      sessionId={sessionId}
      workspaceDiffTarget={workspaceDiffTarget}
      onApprovalResponse={
        approval && onToolApprovalResponse
          ? approvalResponse =>
              onToolApprovalResponse({
                messageId,
                approvalId: approvalResponse.id,
                approved: approvalResponse.approved,
              })
          : undefined
      }
    >
      {children}
    </ToolCallBlock>
  )
}

export function ToolCallBlockByPartIndex({
  sessionId,
  messageId,
  partIndex,
  onToolApprovalResponse,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  onToolApprovalResponse?: MessageToolApprovalHandler
}) {
  const workspaceId = useSessionBinding(sessionId, true)?.workspaceId ?? null
  const workspaceDiffTarget = useMemo(
    () => workspaceId ? { workspaceId } : undefined,
    [workspaceId],
  )
  const displayPart = useMessagePartAt(partIndex)
  const storePart = useChatRenderStore(
    (state) => {
      if (displayPart !== undefined) {
        return null
      }
      return readRenderableToolPartFromState(state, sessionId, messageId, partIndex)
    },
    areRenderableToolPartsEqual,
  )
  const part = displayPart !== undefined
    ? (displayPart ? readRenderableToolPart(displayPart) : null)
    : storePart
  if (!part) {
    return null
  }
  return (
    <ToolCallBlockFromPart
      messageId={messageId}
      part={part}
      sessionId={sessionId}
      workspaceDiffTarget={workspaceDiffTarget}
      onToolApprovalResponse={onToolApprovalResponse}
    />
  )
}

export function GroupedToolCallBlockFromParts({
  items,
  uiKind,
  animated,
  workspaceDiffTarget,
  sessionId,
}: {
  items: Array<{ key: string, part: RenderableToolPart }>
  uiKind: ReturnType<typeof describeToolCall>['kind']
  animated?: boolean
  workspaceDiffTarget?: { workspaceId: string, ownerId?: string | null }
  sessionId?: string
}) {
  const sessionWorkspaceId = useSessionBinding(sessionId ?? '', Boolean(sessionId))?.workspaceId ?? null
  const resolvedWorkspaceDiffTarget = workspaceDiffTarget
    ?? (sessionWorkspaceId ? { workspaceId: sessionWorkspaceId } : undefined)

  if (items.length === 0) {
    return null
  }

  return (
    <GroupedToolCallBlock
      items={items}
      uiKind={uiKind}
      animated={animated}
      workspaceDiffTarget={resolvedWorkspaceDiffTarget}
    />
  )
}

export function GroupedToolCallBlockByPartIndexes({
  items,
  uiKind,
  sessionId,
}: {
  items: Array<{ key: string, messageId: string, partIndex: number }>
  uiKind: ReturnType<typeof describeToolCall>['kind']
  sessionId: string
}) {
  const workspaceId = useSessionBinding(sessionId, true)?.workspaceId ?? null
  const workspaceDiffTarget = useMemo(
    () => workspaceId ? { workspaceId } : undefined,
    [workspaceId],
  )
  const displayParts = useMessageDisplayParts()
  const storeParts = useChatRenderStore(
    (state) => {
      if (displayParts) {
        return []
      }
      return items.flatMap((item) => {
        const part = readRenderableToolPartFromState(
          state,
          sessionId,
          item.messageId,
          item.partIndex,
        )
        return part ? [{ key: item.key, part }] : []
      })
    },
    areGroupedRenderableToolItemsEqual,
  )
  const parts = displayParts
    ? items.flatMap((item) => {
        const part = displayParts[item.partIndex]
        const toolPart = part ? readRenderableToolPart(part) : null
        return toolPart ? [{ key: item.key, part: toolPart }] : []
      })
    : storeParts
  return (
    <GroupedToolCallBlockFromParts
      items={parts}
      uiKind={uiKind}
      workspaceDiffTarget={workspaceDiffTarget}
    />
  )
}

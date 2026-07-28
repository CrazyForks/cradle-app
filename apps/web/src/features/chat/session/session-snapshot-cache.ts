import type { ChatSessionTailMessageSnapshot } from '@cradle/chat-runtime-contracts'
import type { InfiniteData } from '@tanstack/react-query'

import type { GetChatSessionsBySessionIdMessagesResponse } from '~/api-gen/types.gen'

import type { SessionMessageRowsPatch } from './session-sync-engine'
import type { ChatSessionMessageRow } from './use-chat-session-types'

type SnapshotPage = GetChatSessionsBySessionIdMessagesResponse
export type SnapshotInfiniteData = InfiniteData<SnapshotPage, string | null>

/**
 * Apply event-carried message rows to the cached snapshot pages in place of a
 * refetch. Pages are ordered newest-first; new rows land at the tail of the
 * first page (which projection reverses into chronological order).
 * Returns null when the patch is stale or the cache has no pages yet —
 * callers must fall back to a snapshot refetch in that case.
 */
export function applyMessageRowsPatchToSnapshot(
  data: SnapshotInfiniteData | undefined,
  patch: SessionMessageRowsPatch,
): SnapshotInfiniteData | null {
  const firstPage = data?.pages[0]
  if (!data || !firstPage) {
    return null
  }
  if (patch.version <= firstPage.revision) {
    return null
  }

  const upsertsById = new Map(patch.upserts.map(row => [row.messageId, toSnapshotRow(row)]))
  const removals = new Set(patch.removals)
  const pendingAppends = new Map(upsertsById)

  const pages = data.pages.map((page) => {
    const rows = page.rows.flatMap((row) => {
      if (removals.has(row.messageId)) {
        return []
      }
      const upsert = pendingAppends.get(row.messageId)
      if (upsert) {
        pendingAppends.delete(row.messageId)
        return [upsert]
      }
      return [row]
    })
    return { ...page, rows }
  })

  if (pendingAppends.size > 0) {
    pages[0] = {
      ...pages[0],
      rows: [...pages[0].rows, ...pendingAppends.values()],
    }
  }

  return {
    ...data,
    pages: pages.map(page => ({ ...page, revision: patch.version })),
  }
}

function toSnapshotRow(snapshot: ChatSessionTailMessageSnapshot): ChatSessionMessageRow {
  return {
    messageId: snapshot.messageId,
    role: snapshot.role,
    status: snapshot.status,
    ...(snapshot.errorText !== undefined ? { errorText: snapshot.errorText } : {}),
    preview: snapshot.preview,
    previewTruncated: snapshot.previewTruncated,
    parentMessageId: snapshot.parentMessageId,
    parentToolCallId: snapshot.parentToolCallId,
    taskId: snapshot.taskId,
    depth: snapshot.depth,
    message: snapshot.message as ChatSessionMessageRow['message'],
  }
}

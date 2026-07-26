import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'

import type { KanbanBoard } from '~/features/kanban/types'

import { useUpdateBoard } from './use-kanban'

export type StatusCategory = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export interface FilterState {
  statusIds?: string[]
  priorities?: ('none' | 'low' | 'medium' | 'high' | 'urgent')[]
  labels?: string[]
  milestoneId?: string | null
  isDelegated?: boolean | null
}

export interface ViewConfig {
  layout: 'board' | 'list'
  groupBy: 'status' | 'priority' | 'milestone' | 'assignee'
  orderBy: 'manual' | 'priority' | 'created' | 'updated' | 'status'
  orderDirection: 'asc' | 'desc'
  showEmptyGroups: boolean
  displayProperties: {
    id: boolean
    priority: boolean
    status: boolean
    labels: boolean
    assignee: boolean
    agentIndicator: boolean
    milestone: boolean
    dueDate: boolean
    createdAt: boolean
  }
}

/** A board *is* its saved view: layout, grouping, ordering, display, and filters. */
export interface BoardView extends ViewConfig {
  filter: FilterState
}

const displayPropertiesSchema = z.object({
  id: z.boolean().default(true),
  priority: z.boolean().default(true),
  status: z.boolean().default(false),
  labels: z.boolean().default(true),
  assignee: z.boolean().default(true),
  agentIndicator: z.boolean().default(true),
  milestone: z.boolean().default(false),
  dueDate: z.boolean().default(false),
  createdAt: z.boolean().default(false),
})

const filterSchema = z.object({
  statusIds: z.array(z.string()).optional(),
  priorities: z.array(z.enum(['none', 'low', 'medium', 'high', 'urgent'])).optional(),
  labels: z.array(z.string()).optional(),
  milestoneId: z.string().nullable().optional(),
  isDelegated: z.boolean().nullable().optional(),
})

const boardViewSchema = z.object({
  layout: z.enum(['board', 'list']).catch('board').default('board'),
  groupBy: z.enum(['status', 'priority', 'milestone', 'assignee']).catch('status').default('status'),
  orderBy: z
    .enum(['manual', 'priority', 'created', 'updated', 'status'])
    .catch('manual')
    .default('manual'),
  orderDirection: z.enum(['asc', 'desc']).catch('asc').default('asc'),
  showEmptyGroups: z.boolean().catch(true).default(true),
  displayProperties: displayPropertiesSchema.catch(() => displayPropertiesSchema.parse({})).default(() => displayPropertiesSchema.parse({})),
  filter: filterSchema.catch(() => ({})).default({}),
})

export const defaultBoardView: BoardView = boardViewSchema.parse({})

export function parseBoardView(filterConfig: string | null | undefined): BoardView {
  if (!filterConfig) {
    return defaultBoardView
  }
  try {
    return boardViewSchema.parse(JSON.parse(filterConfig))
  }
  catch {
    return defaultBoardView
  }
}

const PERSIST_DEBOUNCE_MS = 500

/**
 * Board view state, persisted server-side on the board itself.
 *
 * Boards used to be name-only rows over one shared per-workspace `localStorage` blob,
 * so every board on a workspace rendered the identical view. The saved view now lives
 * in `board.filterConfig`, which is what makes two boards two different things.
 */
export function useBoardView(board: KanbanBoard | undefined) {
  const boardId = board?.id
  const updateBoard = useUpdateBoard()
  const persisted = useMemo(() => parseBoardView(board?.filterConfig), [board?.filterConfig])

  const [view, setView] = useState<BoardView>(persisted)
  const hydratedBoardIdRef = useRef(boardId)
  const pendingRef = useRef<BoardView | null>(null)

  // Re-hydrate only when switching boards; a refetch of the current board must not
  // clobber edits the user is still making.
  useEffect(() => {
    if (hydratedBoardIdRef.current === boardId) {
      return
    }
    hydratedBoardIdRef.current = boardId
    pendingRef.current = null
    setView(persisted)
  }, [boardId, persisted])

  useEffect(() => {
    const pending = pendingRef.current
    if (!boardId || !pending) {
      return
    }
    const timer = window.setTimeout(() => {
      pendingRef.current = null
      updateBoard.mutate({ id: boardId, patch: { filterConfig: JSON.stringify(pending) } })
    }, PERSIST_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // `updateBoard` is a stable mutation object per render; only the queued view matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, view])

  const commit = useCallback((next: BoardView) => {
    pendingRef.current = next
    setView(next)
  }, [])

  const setConfig = useCallback(
    (patch: Partial<ViewConfig>) => {
      setView((prev) => {
        const next: BoardView = {
          ...prev,
          ...patch,
          displayProperties: patch.displayProperties
            ? { ...prev.displayProperties, ...patch.displayProperties }
            : prev.displayProperties,
        }
        pendingRef.current = next
        return next
      })
    },
    [],
  )

  const setFilter = useCallback((patch: Partial<FilterState>) => {
    setView((prev) => {
      const next: BoardView = { ...prev, filter: { ...prev.filter, ...patch } }
      pendingRef.current = next
      return next
    })
  }, [])

  const resetFilter = useCallback(() => {
    setView((prev) => {
      const next: BoardView = { ...prev, filter: {} }
      pendingRef.current = next
      return next
    })
  }, [])

  return { view, commit, setConfig, setFilter, resetFilter, filter: view.filter }
}

export function hasActiveFilter(filter: FilterState): boolean {
  return Boolean(
    filter.statusIds?.length
    || filter.priorities?.length
    || filter.labels?.length
    || filter.milestoneId
    || filter.isDelegated != null,
  )
}

import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { move } from '@dnd-kit/helpers'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/react'
import { DragDropProvider, DragOverlay } from '@dnd-kit/react'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'

import type { KanbanCardRuntimeData } from './kanban-card'
import { KanbanCardPreview } from './kanban-card'
import { KanbanColumn } from './kanban-column'
import type { GroupedKanbanIssues } from './kanban-grouping'
import type { IssueSelectionMode } from './kanban-selection'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import type { ViewConfig } from './use-board-view'

/** Where a card came to rest: its destination group and its index within it. */
export interface KanbanDropResult {
  issueId: string
  fromGroupId: string
  toGroupId: string
  /** Issue ids of the destination group, in final display order. */
  orderedIds: string[]
}

interface BoardProps {
  workspaceId: string
  grouped: GroupedKanbanIssues
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  parentIssueRefs: Map<string, ParentIssueRef>
  config: ViewConfig
  onIssueClick: (id: string) => void
  onIssueSelectionGesture?: (id: string, mode: IssueSelectionMode) => void
  onIssueHover?: (id: string | null) => void
  onIssueDrop: (result: KanbanDropResult) => void
  onCreateIssue: (groupId: string) => void
  highlightedIssueId?: string | null
  selectedIssueIds?: Set<string>
  runtimeData?: KanbanCardRuntimeData
}

type IssuesByGroup = Record<string, KanbanBoardIssue[]>

export function KanbanBoardSurface({
  workspaceId,
  grouped,
  statuses,
  milestones,
  parentIssueRefs,
  config,
  onIssueClick,
  onIssueSelectionGesture,
  onIssueHover,
  onIssueDrop,
  onCreateIssue,
  highlightedIssueId,
  selectedIssueIds,
  runtimeData,
}: BoardProps) {
  const { groups } = grouped

  const serverColumns = useMemo<IssuesByGroup>(() => {
    const columns: IssuesByGroup = {}
    for (const group of groups) {
      columns[group.id] = grouped.issuesByGroup.get(group.id) ?? []
    }
    return columns
  }, [groups, grouped.issuesByGroup])

  /**
   * Card positions while a drag is in flight.
   *
   * dnd-kit reorders the DOM optimistically as you drag. If the board kept
   * rendering straight from server data, that DOM would diverge from React's
   * tree — the dragged card ends up parented in one column and reconciled from
   * another, which is what produced duplicate cards that no longer responded to
   * a second drag. Owning the order locally keeps both views on one list, and
   * dropping back to `null` on settle hands authority back to the server.
   */
  const [dragColumns, setDragColumns] = useState<IssuesByGroup | null>(null)
  const columns = dragColumns ?? serverColumns

  // Read inside handlers without making them a drag-invalidating dependency.
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const sourceGroupRef = useRef<string | null>(null)

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const issueId = String(event.operation.source?.id ?? '')
    const current = columnsRef.current
    sourceGroupRef.current
      = Object.keys(current).find(groupId => current[groupId].some(issue => issue.id === issueId))
        ?? null
    setDragColumns(current)
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    // `move` resolves the pointer against the sortable registry and returns the
    // list as it should look right now, so the gap opens under the cursor
    // instead of only at drop time.
    setDragColumns(current => move(current ?? columnsRef.current, event))
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { operation, canceled } = event
    const issueId = String(operation.source?.id ?? '')
    const fromGroupId = sourceGroupRef.current
    sourceGroupRef.current = null

    if (canceled || !issueId || !fromGroupId) {
      setDragColumns(null)
      return
    }

    const settled = move(columnsRef.current, event)
    const toGroupId = Object.keys(settled)
      .find(groupId => settled[groupId].some(issue => issue.id === issueId))

    if (!toGroupId) {
      setDragColumns(null)
      return
    }

    // Hold the optimistic layout until the mutation writes it into the cache;
    // clearing here would flash the card back to its old slot for a frame.
    setDragColumns(settled)

    onIssueDrop({
      issueId,
      fromGroupId,
      toGroupId,
      orderedIds: settled[toGroupId].map(issue => issue.id),
    })
  }, [onIssueDrop])

  return (
    <DragDropProvider
      sensors={defaults => [
        ...defaults.filter(sensor => sensor !== PointerSensor),
        PointerSensor.configure({
          activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
        }),
      ]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-1 gap-2.5 overflow-x-auto px-3 py-2.5" data-testid="kanban-board">
        {groups.map(group => (
          <KanbanColumn
            key={group.id}
            workspaceId={workspaceId}
            group={group}
            issues={columns[group.id] ?? []}
            statuses={statuses}
            milestones={milestones}
            parentIssueRefs={parentIssueRefs}
            displayProperties={config.displayProperties}
            onIssueClick={onIssueClick}
            onIssueSelectionGesture={onIssueSelectionGesture}
            onIssueHover={onIssueHover}
            onCreateIssue={onCreateIssue}
            highlightedIssueId={highlightedIssueId}
            selectedIssueIds={selectedIssueIds}
            runtimeData={runtimeData}
          />
        ))}
      </div>

      <DragOverlay>
        {(source) => {
          const issue = source.data?.issue as KanbanBoardIssue | undefined
          if (!issue) {
            return null
          }
          return (
            // Width matches the column's content box exactly (w-80 minus px-2),
            // so the card does not resize as it leaves the list.
            <div className="w-[304px] rotate-[-1deg] scale-[1.02] transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]">
              <KanbanCardPreview
                issue={issue}
                index={0}
                statuses={statuses}
                milestones={milestones}
                parentIssueRef={parentIssueRefs.get(issue.id) ?? null}
                displayProperties={config.displayProperties}
                onOpenIssue={() => {}}
                selected={selectedIssueIds?.has(issue.id)}
                runtimeData={runtimeData}
              />
            </div>
          )
        }}
      </DragOverlay>
    </DragDropProvider>
  )
}

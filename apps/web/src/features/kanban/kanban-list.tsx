import { useState } from 'react'

import type { KanbanMilestone, KanbanStatus } from '~/features/kanban/types'

import { KanbanGroupHeader } from './kanban-group-header'
import type { GroupedKanbanIssues } from './kanban-grouping'
import { KanbanListRow } from './kanban-list-row'
import type { IssueSelectionMode } from './kanban-selection'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import type { ViewConfig } from './use-board-view'

interface ListProps {
  grouped: GroupedKanbanIssues
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  parentIssueRefs: Map<string, ParentIssueRef>
  config: ViewConfig
  highlightedIssueId?: string | null
  selectedIssueIds?: Set<string>
  onIssueClick: (id: string) => void
  onIssueSelectionGesture?: (id: string, mode: IssueSelectionMode) => void
  onIssueHover?: (id: string | null) => void
  onCreateIssue?: (groupId: string) => void
}

export function KanbanList({
  grouped,
  statuses,
  milestones,
  parentIssueRefs,
  config,
  highlightedIssueId,
  selectedIssueIds,
  onIssueHover,
  onCreateIssue,
  onIssueClick,
  onIssueSelectionGesture,
}: ListProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  return (
    <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
      {grouped.groups.map((group) => {
        const groupIssues = grouped.issuesByGroup.get(group.id) ?? []
        const isCollapsed = collapsed[group.id] ?? false

        return (
          <div key={group.id} className="flex flex-col">
            <KanbanGroupHeader
              name={group.name}
              count={groupIssues.length}
              category={group.category}
              collapsed={isCollapsed}
              onToggle={() =>
                setCollapsed(prev => ({ ...prev, [group.id]: !(prev[group.id] ?? false) }))}
              onCreateIssue={onCreateIssue ? () => onCreateIssue(group.id) : undefined}
            />
            {!isCollapsed && (
              <div className="flex flex-col gap-0.5">
                {groupIssues.map(issue => (
                  <KanbanListRow
                    key={issue.id}
                    issue={issue}
                    statuses={statuses}
                    milestones={milestones}
                    parentIssueRef={parentIssueRefs.get(issue.id) ?? null}
                    displayProperties={config.displayProperties}
                    onOpenIssue={onIssueClick}
                    onSelectionGesture={onIssueSelectionGesture}
                    onHover={onIssueHover}
                    highlighted={issue.id === highlightedIssueId}
                    selected={selectedIssueIds?.has(issue.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

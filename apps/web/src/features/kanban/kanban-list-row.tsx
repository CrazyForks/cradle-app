import {
  CalendarLine as CalendarIcon,
  Flag3Line as MilestoneIcon,
  GitBranchLine as GitBranchIcon,
} from '@mingcute/react'
import type { MouseEvent } from 'react'

import { AgentAvatar } from '~/features/agent-runtime/agent-avatar'
import { useAgents } from '~/features/agent-runtime/use-agents'
import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'
import { isExternalKanbanIssue } from '~/features/kanban/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { IssueContextMenu } from './issue-context-menu'
import { AssigneeAvatar } from './shared/assignee-avatar'
import { formatIssueId } from './shared/format-issue-id'
import { formatRelativeAge, formatShortDate } from './shared/format-time'
import { findDelegatedAgent } from './shared/issue-delegation'
import { LabelChip } from './shared/label-chip'
import { ParentIssueLink } from './shared/parent-issue-link'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import { PriorityIcon } from './shared/priority-icon'
import { SelectionToggle } from './shared/selection-toggle'
import { StatusIcon } from './shared/status-icon'
import type { StatusCategory, ViewConfig } from './use-board-view'

interface ListRowProps {
  issue: KanbanBoardIssue
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  parentIssueRef?: ParentIssueRef | null
  displayProperties: ViewConfig['displayProperties']
  onOpenIssue: (id: string) => void
  onSelectionGesture?: (id: string, mode: 'toggle' | 'range') => void
  onHover?: (id: string | null) => void
  highlighted?: boolean
  selected?: boolean
}

export function KanbanListRow({
  issue,
  statuses,
  milestones,
  parentIssueRef,
  displayProperties,
  onOpenIssue,
  onSelectionGesture,
  onHover,
  highlighted,
  selected,
}: ListRowProps) {
  const { workspaces } = useWorkspaces()
  const { agents } = useAgents()
  const status = statuses.find(candidate => candidate.id === issue.statusId)
  const category = (status?.category ?? 'unstarted') as StatusCategory
  const external = isExternalKanbanIssue(issue)
  const delegatedAgent = findDelegatedAgent(issue, agents)
  const milestone = issue.milestoneId
    ? milestones.find(candidate => candidate.id === issue.milestoneId)
    : undefined
  const showAssigneeAvatar = displayProperties.assignee && issue.assigneeId
  const showAgentAvatar = displayProperties.agentIndicator && delegatedAgent

  const handleOpenIssue = () => onOpenIssue(issue.id)

  const handleRowClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (onSelectionGesture && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onSelectionGesture(issue.id, event.shiftKey ? 'range' : 'toggle')
      return
    }
    handleOpenIssue()
  }

  const row = (
    <div
      onMouseEnter={() => onHover?.(issue.id)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        'group/row relative flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px]',
        'cursor-pointer transition-colors duration-100',
        selected ? 'bg-primary/[0.06]' : highlighted ? 'bg-fill' : 'hover:bg-fill/70',
        external && 'bg-fill/25',
      )}
    >
      <button
        type="button"
        aria-label={`${selected ? 'Selected issue' : 'Open issue'} ${issue.title}`}
        aria-pressed={selected ? true : undefined}
        onClick={handleRowClick}
        className="absolute inset-0 z-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      <span
        className={cn(
          'absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary',
          'transition-opacity duration-100',
          selected ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden="true"
      />

      <SelectionToggle
        selected={Boolean(selected)}
        onToggle={onSelectionGesture ? () => onSelectionGesture(issue.id, 'toggle') : undefined}
        label={issue.title}
      />

      <span className="pointer-events-none relative z-10 flex shrink-0 items-center gap-1.5">
        {displayProperties.status && <StatusIcon category={category} size={14} />}
        {displayProperties.priority && <PriorityIcon priority={issue.priority} size={14} />}
      </span>

      {displayProperties.id && (
        <span className="pointer-events-none relative z-10 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {external ? issue.externalIssue.externalKey : formatIssueId(issue, workspaces)}
        </span>
      )}

      {external && (
        <span className="pointer-events-none relative z-10 inline-flex shrink-0 items-center gap-1 rounded bg-fill px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
          <GitBranchIcon className="size-2.5" aria-hidden="true" />
          GitHub
        </span>
      )}

      {parentIssueRef && (
        <span className="relative z-10 flex shrink-0 items-center">
          <ParentIssueLink
            parentIssueKey={parentIssueRef.key}
            variant="row"
            onOpen={() => onOpenIssue(parentIssueRef.id)}
          />
        </span>
      )}

      <span className="pointer-events-none relative z-10 flex-1 truncate text-foreground">
        {issue.title}
      </span>

      <span
        className={cn(
          'pointer-events-none relative z-10 flex shrink-0 items-center gap-2 text-muted-foreground',
          'transition-opacity duration-100',
          selected || highlighted ? 'opacity-100' : 'opacity-70 group-hover/row:opacity-100',
        )}
      >
        {displayProperties.milestone && milestone && (
          <span className="flex max-w-32 items-center gap-1 text-[11px]">
            <MilestoneIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{milestone.title}</span>
          </span>
        )}

        {displayProperties.dueDate && issue.dueDate && (
          <span className="flex items-center gap-1 text-[11px] tabular-nums">
            <CalendarIcon className="size-3 shrink-0" aria-hidden="true" />
            {formatShortDate(issue.dueDate)}
          </span>
        )}

        {displayProperties.labels && issue.labels.length > 0 && (
          <span className="flex items-center gap-1">
            {issue.labels.slice(0, 2).map(label => (
              <LabelChip key={label} label={label} />
            ))}
            {issue.labels.length > 2 && (
              <span className="text-[11px] tabular-nums">
                +
                {issue.labels.length - 2}
              </span>
            )}
          </span>
        )}

        {(showAssigneeAvatar || showAgentAvatar) && (
          <span className="flex items-center -space-x-1.5 *:ring-2 *:ring-background">
            {showAssigneeAvatar && <AssigneeAvatar name={issue.assigneeId} size={16} />}
            {showAgentAvatar && (
              <AgentAvatar
                name={delegatedAgent.name}
                avatarUrl={delegatedAgent.avatarUrl}
                avatarStyle={delegatedAgent.avatarStyle}
                avatarSeed={delegatedAgent.avatarSeed}
                size={16}
              />
            )}
          </span>
        )}

        {displayProperties.createdAt && (
          // `createdAt` is unix seconds; the old row subtracted it from a millisecond
          // clock, so every issue read as tens of thousands of days old.
          <span className="w-8 text-right text-[11px] tabular-nums">
            {formatRelativeAge(issue.createdAt)}
          </span>
        )}
      </span>
    </div>
  )

  if (external) {
    return row
  }

  return (
    <IssueContextMenu
      issue={issue}
      statuses={statuses}
      milestones={milestones}
      onOpen={handleOpenIssue}
    >
      {row}
    </IssueContextMenu>
  )
}

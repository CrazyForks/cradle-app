import {
  CalendarLine as CalendarIcon,
  Flag3Line as MilestoneIcon,
  GitBranchLine as GitBranchIcon,
} from '@mingcute/react'
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentAvatar } from '~/features/agent-runtime/agent-avatar'
import type { Agent } from '~/features/agent-runtime/use-agents'
import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'
import { isExternalKanbanIssue } from '~/features/kanban/types'
import type { Workspace } from '~/features/workspace/types'
import { cn } from '~/lib/cn'

import { AssigneeAvatar } from './shared/assignee-avatar'
import { formatIssueId } from './shared/format-issue-id'
import { formatShortDate } from './shared/format-time'
import { findDelegatedAgent } from './shared/issue-delegation'
import { LabelChip } from './shared/label-chip'
import { ParentIssueLink } from './shared/parent-issue-link'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import { PriorityIcon } from './shared/priority-icon'
import { SelectionToggle } from './shared/selection-toggle'
import { StatusCategorySchema, StatusIcon } from './shared/status-icon'
import type { StatusCategory, ViewConfig } from './use-board-view'

export interface KanbanCardRuntimeData {
  workspaces: Workspace[]
  agents: Agent[]
}

export interface KanbanCardViewProps extends HTMLAttributes<HTMLDivElement> {
  issue: KanbanBoardIssue
  statuses: KanbanStatus[]
  milestones?: KanbanMilestone[]
  parentIssueRef?: ParentIssueRef | null
  displayProperties: ViewConfig['displayProperties']
  onOpenIssue: (id: string) => void
  onToggleSelected?: () => void
  runtimeData: KanbanCardRuntimeData
  category?: StatusCategory
  highlighted?: boolean
  selected?: boolean
  cardRef?: Ref<HTMLDivElement>
  style?: CSSProperties
  pressed?: boolean
  dragging?: boolean
  preview?: boolean
  children?: ReactNode
}

const priorityLabelKeys = {
  urgent: 'priority.urgent',
  high: 'priority.high',
  medium: 'priority.medium',
  low: 'priority.low',
  none: 'priority.none',
} as const

export function KanbanCardView({
  issue,
  statuses,
  milestones = [],
  parentIssueRef,
  displayProperties,
  onOpenIssue,
  onToggleSelected,
  category,
  highlighted,
  selected,
  cardRef,
  style,
  pressed,
  dragging,
  preview,
  children,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onBlur,
  runtimeData,
  ...cardProps
}: KanbanCardViewProps) {
  const { t } = useTranslation('kanban')
  const { workspaces, agents } = runtimeData
  const external = isExternalKanbanIssue(issue)
  const issueStatus = statuses.find(status => status.id === issue.statusId)
  const statusCategory = StatusCategorySchema.parse(issueStatus?.category ?? category)
  const delegatedAgent = findDelegatedAgent(issue, agents)
  const milestone = issue.milestoneId
    ? milestones.find(candidate => candidate.id === issue.milestoneId)
    : undefined
  const showAssigneeAvatar = displayProperties.assignee && issue.assigneeId
  const showAgentAvatar = displayProperties.agentIndicator && delegatedAgent
  const showMilestone = displayProperties.milestone && milestone
  const showDueDate = displayProperties.dueDate && issue.dueDate
  const showCreatedAt = displayProperties.createdAt && issue.createdAt
  const showFooter
    = (displayProperties.priority && issue.priority !== 'none')
      || (displayProperties.labels && issue.labels.length > 0)
      || showMilestone
      || showDueDate
      || showCreatedAt

  return (
    <div
      {...cardProps}
      ref={cardRef}
      style={style}
      data-pressed={pressed ? 'true' : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onBlur={onBlur}
      data-testid={`issue-card-${issue.id}`}
      className={cn(
        'group/card relative flex w-full cursor-pointer flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left',
        'bg-card ring-1 ring-inset ring-border',
        // Depth is a ring plus a tightened fill, never a lift — the design system
        // treats drop shadows on interactive elements as a defect.
        'transition-[background-color,box-shadow,scale] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'hover:ring-border-strong',
        'data-[pressed=true]:scale-[0.99]',
        highlighted && !selected && 'ring-muted-foreground/40',
        selected && 'bg-primary/[0.04] ring-primary/60',
        external && 'bg-fill/30',
        dragging && 'opacity-40',
        preview && 'pointer-events-none ring-primary/40',
      )}
    >
      {children}

      <div className="relative z-10 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <SelectionToggle
            selected={Boolean(selected)}
            onToggle={onToggleSelected}
            label={issue.title}
          />

          {displayProperties.id && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
              {external ? issue.externalIssue.externalKey : formatIssueId(issue, workspaces)}
            </span>
          )}
          {external && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-fill px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
              <GitBranchIcon className="size-2.5" aria-hidden="true" />
              GitHub
            </span>
          )}
          {parentIssueRef && (
            <ParentIssueLink
              parentIssueKey={parentIssueRef.key}
              variant="card"
              onOpen={() => onOpenIssue(parentIssueRef.id)}
            />
          )}
        </div>

        {(showAssigneeAvatar || showAgentAvatar) && (
          <span className="flex shrink-0 items-center -space-x-1.5 *:ring-2 *:ring-card">
            {showAssigneeAvatar && <AssigneeAvatar name={issue.assigneeId} size={18} />}
            {showAgentAvatar && (
              <AgentAvatar
                name={delegatedAgent.name}
                avatarUrl={delegatedAgent.avatarUrl}
                avatarStyle={delegatedAgent.avatarStyle}
                avatarSeed={delegatedAgent.avatarSeed}
                size={18}
              />
            )}
          </span>
        )}
      </div>

      <div className="pointer-events-none relative z-10 flex items-start gap-2">
        {displayProperties.status && (
          <span className="mt-0.5 shrink-0">
            <StatusIcon category={statusCategory} size={15} />
          </span>
        )}
        <span className="text-[13px] font-medium leading-snug text-foreground text-pretty">
          {issue.title}
        </span>
      </div>

      {showFooter && (
        <div className="pointer-events-none relative z-10 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted-foreground">
          {displayProperties.priority && issue.priority !== 'none' && (
            <span className="flex items-center gap-1 text-[11px]">
              <PriorityIcon priority={issue.priority} size={13} />
              <span>{t(priorityLabelKeys[issue.priority])}</span>
            </span>
          )}

          {showMilestone && (
            <span className="flex min-w-0 items-center gap-1 text-[11px]">
              <MilestoneIcon className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{milestone.title}</span>
            </span>
          )}

          {showDueDate && (
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

          {showCreatedAt && (
            <span className="ml-auto text-[11px] tabular-nums">
              {formatShortDate(issue.createdAt)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

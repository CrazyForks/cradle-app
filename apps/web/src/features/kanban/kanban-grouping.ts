import type { TFunction } from 'i18next'

import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'

import type { StatusCategory, ViewConfig } from './use-board-view'

export const UNGROUPED_ID = '__none__'
export const CURRENT_USER_ASSIGNEE_ID = '__self__'

const priorityGroupOrder = ['urgent', 'high', 'medium', 'low', 'none'] as const

const priorityLabelKeys = {
  urgent: 'priority.urgent',
  high: 'priority.high',
  medium: 'priority.medium',
  low: 'priority.low',
  none: 'priority.none',
} as const

export interface KanbanGroup {
  id: string
  name: string
  category?: StatusCategory
  /** Patch applied to issues created from, or dragged into, this group. */
  assignPatch: KanbanGroupAssignPatch | null
}

export type KanbanGroupAssignPatch
  = | { statusId: string }
    | { priority: 'none' | 'low' | 'medium' | 'high' | 'urgent' }
    | { milestoneId: string | null }
    | { assigneeKind: string | null, assigneeId: string | null }

/**
 * Group definitions for the current view, in display order.
 *
 * Board, list, and keyboard-navigation ordering all read from here so a group set
 * can never drift between surfaces — the previous per-surface copies silently fell
 * back to status grouping for modes they had not implemented.
 */
export function buildKanbanGroups({
  groupBy,
  statuses,
  milestones,
  issues,
  t,
}: {
  groupBy: ViewConfig['groupBy']
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  issues: KanbanBoardIssue[]
  t: TFunction<'kanban'>
}): KanbanGroup[] {
  if (groupBy === 'priority') {
    return priorityGroupOrder.map(priority => ({
      id: priority,
      name: t(priorityLabelKeys[priority]),
      assignPatch: { priority },
    }))
  }

  if (groupBy === 'milestone') {
    return [
      ...milestones.map(milestone => ({
        id: milestone.id,
        name: milestone.title,
        assignPatch: { milestoneId: milestone.id },
      })),
      { id: UNGROUPED_ID, name: t('noMilestone'), assignPatch: { milestoneId: null } },
    ]
  }

  if (groupBy === 'assignee') {
    const assigneeIds: string[] = []
    for (const issue of issues) {
      if (issue.assigneeId && !assigneeIds.includes(issue.assigneeId)) {
        assigneeIds.push(issue.assigneeId)
      }
    }
    return [
      ...assigneeIds.map(assigneeId => ({
        id: assigneeId,
        name: assigneeId === CURRENT_USER_ASSIGNEE_ID ? t('assignee.currentUser') : assigneeId,
        assignPatch: { assigneeKind: 'user', assigneeId },
      })),
      {
        id: UNGROUPED_ID,
        name: t('assignee.unassigned'),
        assignPatch: { assigneeKind: null, assigneeId: null },
      },
    ]
  }

  return statuses.map(status => ({
    id: status.id,
    name: status.name,
    category: status.category,
    assignPatch: { statusId: status.id },
  }))
}

export function issueGroupId(issue: KanbanBoardIssue, groupBy: ViewConfig['groupBy']): string {
  if (groupBy === 'priority') {
    return issue.priority
  }
  if (groupBy === 'milestone') {
    return issue.milestoneId ?? UNGROUPED_ID
  }
  if (groupBy === 'assignee') {
    return issue.assigneeId ?? UNGROUPED_ID
  }
  return issue.statusId ?? UNGROUPED_ID
}

export interface GroupedKanbanIssues {
  groups: KanbanGroup[]
  issuesByGroup: Map<string, KanbanBoardIssue[]>
  /** Group id per issue id, for drag targets and move short-circuits. */
  groupIdByIssue: Map<string, string>
}

export function groupKanbanIssues({
  issues,
  groups,
  groupBy,
  showEmptyGroups,
}: {
  issues: KanbanBoardIssue[]
  groups: KanbanGroup[]
  groupBy: ViewConfig['groupBy']
  showEmptyGroups: boolean
}): GroupedKanbanIssues {
  const issuesByGroup = new Map<string, KanbanBoardIssue[]>()
  const groupIdByIssue = new Map<string, string>()
  for (const group of groups) {
    issuesByGroup.set(group.id, [])
  }

  const orphanGroupIds: string[] = []
  for (const issue of issues) {
    const groupId = issueGroupId(issue, groupBy)
    groupIdByIssue.set(issue.id, groupId)
    const bucket = issuesByGroup.get(groupId)
    if (bucket) {
      bucket.push(issue)
      continue
    }
    // An issue can point at a status that no longer exists; surface it instead of dropping it.
    issuesByGroup.set(groupId, [issue])
    orphanGroupIds.push(groupId)
  }

  const allGroups = orphanGroupIds.length === 0
    ? groups
    : [
        ...groups,
        ...orphanGroupIds.map(id => ({ id, name: id, assignPatch: null })),
      ]

  const visibleGroups = showEmptyGroups
    ? allGroups
    : allGroups.filter(group => (issuesByGroup.get(group.id)?.length ?? 0) > 0)

  return { groups: visibleGroups, issuesByGroup, groupIdByIssue }
}

/** Flattened issue order matching what the board/list actually renders. */
export function orderedIssuesForGroups(grouped: GroupedKanbanIssues): KanbanBoardIssue[] {
  return grouped.groups.flatMap(group => grouped.issuesByGroup.get(group.id) ?? [])
}

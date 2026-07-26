import { CollisionPriority } from '@dnd-kit/abstract'
import { useDroppable } from '@dnd-kit/react'
import { PlusLine as PlusIcon } from '@mingcute/react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'
import { cn } from '~/lib/cn'

import type { KanbanCardRuntimeData } from './kanban-card'
import { KanbanCard } from './kanban-card'
import type { KanbanGroup } from './kanban-grouping'
import type { IssueSelectionMode } from './kanban-selection'
import { StatusIcon } from './shared/status-icon'
import type { ViewConfig } from './use-board-view'
import { useCreateIssue } from './use-kanban'

interface ColumnProps {
  workspaceId: string
  group: KanbanGroup
  issues: KanbanBoardIssue[]
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  parentIssueRefs: Map<string, { id: string, key: string }>
  displayProperties: ViewConfig['displayProperties']
  onIssueClick: (id: string) => void
  onIssueSelectionGesture?: (id: string, mode: IssueSelectionMode) => void
  onIssueHover?: (id: string | null) => void
  onCreateIssue: (groupId: string) => void
  highlightedIssueId?: string | null
  selectedIssueIds?: Set<string>
  runtimeData?: KanbanCardRuntimeData
}

export function KanbanColumn({
  workspaceId,
  group,
  issues,
  statuses,
  milestones,
  parentIssueRefs,
  displayProperties,
  onIssueClick,
  onIssueSelectionGesture,
  onIssueHover,
  onCreateIssue,
  highlightedIssueId,
  selectedIssueIds,
  runtimeData,
}: ColumnProps) {
  const { t } = useTranslation('kanban')
  // Low priority: the column only wins a collision over empty space below the
  // cards. Otherwise it competed with its own children and a drop between two
  // cards resolved to the column, discarding the position.
  const droppable = useDroppable({
    id: group.id,
    type: 'column',
    accept: 'issue',
    collisionPriority: CollisionPriority.Low,
  })
  const [composing, setComposing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const createIssue = useCreateIssue()
  // Escape must abort without the ensuing blur committing the draft anyway.
  const abortedRef = useRef(false)

  const startComposing = () => {
    if (runtimeData) {
      onCreateIssue(group.id)
      return
    }
    abortedRef.current = false
    setDraftTitle('')
    setComposing(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const commitDraft = (keepComposing: boolean) => {
    const title = draftTitle.trim()
    if (!title) {
      setComposing(false)
      return
    }

    createIssue.mutate(
      {
        workspaceId,
        title,
        priority: 'none',
        // Create into whatever field this column represents — a priority column
        // used to write its own id into `statusId`, producing an orphaned issue.
        ...(group.assignPatch ?? {}),
      },
      {
        onSuccess: () => {
          setDraftTitle('')
          setComposing(keepComposing)
          if (keepComposing) {
            requestAnimationFrame(() => inputRef.current?.focus())
          }
        },
        onError: () => setComposing(false),
      },
    )
  }

  return (
    <div
      className="flex h-full w-80 shrink-0 flex-col rounded-xl bg-fill/40"
      data-kanban-column-id={group.id}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {group.category && <StatusIcon category={group.category} size={14} />}
        <span
          className="text-[12px] font-medium text-foreground"
          data-testid={`kanban-column-title-${group.id}`}
        >
          {group.name}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{issues.length}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={startComposing}
          aria-label={t('issue.createInGroup', { group: group.name })}
          data-testid={`kanban-column-add-${group.id}`}
          className={cn(
            'flex size-5 items-center justify-center rounded text-muted-foreground',
            'transition-colors duration-100 hover:bg-fill hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <PlusIcon className="size-3" aria-hidden="true" />
        </button>
      </div>

      <div
        ref={droppable.ref}
        data-testid={`kanban-column-dropzone-${group.id}`}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2',
          'transition-colors duration-100',
          droppable.isDropTarget && 'rounded-b-xl bg-fill/80',
        )}
      >
        {issues.map((issue, index) => (
          <KanbanCard
            key={issue.id}
            issue={issue}
            index={index}
            sortableGroupId={group.id}
            statuses={statuses}
            milestones={milestones}
            parentIssueRef={parentIssueRefs.get(issue.id) ?? null}
            displayProperties={displayProperties}
            category={group.category}
            onOpenIssue={onIssueClick}
            onSelectionGesture={onIssueSelectionGesture}
            onHover={onIssueHover}
            highlighted={issue.id === highlightedIssueId}
            selected={selectedIssueIds?.has(issue.id)}
            runtimeData={runtimeData}
          />
        ))}

        {composing && (
          <input
            ref={inputRef}
            value={draftTitle}
            aria-label={t('issue.newTitlePlaceholder')}
            onChange={event => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                // Enter keeps the composer open so a column can be filled in one pass.
                commitDraft(true)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                abortedRef.current = true
                setComposing(false)
              }
            }}
            onBlur={() => {
              if (abortedRef.current) {
                abortedRef.current = false
                return
              }
              commitDraft(false)
            }}
            placeholder={t('issue.newTitlePlaceholder')}
            data-testid="kanban-new-issue-input"
            className={cn(
              'w-full rounded-md border border-border bg-card px-2.5 py-2 text-[13px] text-foreground',
              'outline-none transition-colors placeholder:text-muted-foreground focus:border-ring',
            )}
          />
        )}

        {!composing && issues.length === 0 && (
          <button
            type="button"
            onClick={startComposing}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-2 text-[12px] text-muted-foreground',
              'transition-colors duration-100 hover:bg-fill hover:text-foreground',
            )}
          >
            <PlusIcon className="size-3" aria-hidden="true" />
            {t('issue.create')}
          </button>
        )}
      </div>
    </div>
  )
}

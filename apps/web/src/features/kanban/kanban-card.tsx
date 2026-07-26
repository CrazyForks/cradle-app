import { CollisionPriority } from '@dnd-kit/abstract'
import { useSortable } from '@dnd-kit/react/sortable'
import type { HTMLAttributes, MouseEvent, PointerEvent } from 'react'
import { useState } from 'react'

import { useAgents } from '~/features/agent-runtime/use-agents'
import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'
import { isExternalKanbanIssue } from '~/features/kanban/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'

import { IssueContextMenu } from './issue-context-menu'
import type { KanbanCardRuntimeData, KanbanCardViewProps } from './kanban-card-view'
import { KanbanCardView as CardView } from './kanban-card-view'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import type { StatusCategory, ViewConfig } from './use-board-view'

interface CardProps {
  issue: KanbanBoardIssue
  index: number
  sortableGroupId?: string
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  parentIssueRef?: ParentIssueRef | null
  displayProperties: ViewConfig['displayProperties']
  onOpenIssue: (id: string) => void
  onSelectionGesture?: (id: string, mode: 'toggle' | 'range') => void
  onHover?: (id: string | null) => void
  category?: StatusCategory
  highlighted?: boolean
  selected?: boolean
  runtimeData?: KanbanCardRuntimeData
}

export type { KanbanCardRuntimeData } from './kanban-card-view'

type CardChromeProps = Pick<
  CardProps,
  | 'issue'
  | 'statuses'
  | 'milestones'
  | 'parentIssueRef'
  | 'displayProperties'
  | 'category'
  | 'highlighted'
  | 'selected'
  | 'runtimeData'
>
& HTMLAttributes<HTMLDivElement>
& Pick<KanbanCardViewProps, 'cardRef' | 'style' | 'pressed' | 'dragging' | 'preview' | 'children' | 'onToggleSelected'>
& { onOpenIssue: (id: string) => void }

function KanbanCardContainer({
  issue,
  index,
  sortableGroupId,
  statuses,
  milestones,
  parentIssueRef,
  displayProperties,
  onOpenIssue,
  onSelectionGesture,
  onHover,
  category,
  highlighted,
  selected,
  runtimeData,
}: CardProps) {
  const [pressed, setPressed] = useState(false)
  const sortable = useSortable({
    id: issue.id,
    index,
    group: sortableGroupId,
    type: 'issue',
    accept: 'issue',
    data: { issue },
    // Cards outrank the column droppable so a drop between two cards resolves to
    // a position rather than to the column as a whole.
    collisionPriority: CollisionPriority.High,
    transition: { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  })

  const handleOpenIssue = () => onOpenIssue(issue.id)

  const handleCardClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setPressed(false)

    if (onSelectionGesture && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onSelectionGesture(issue.id, event.shiftKey ? 'range' : 'toggle')
      return
    }

    // Opening is immediate. The old card deferred this behind a 90 ms timer, which
    // read as input lag on every single click.
    handleOpenIssue()
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button === 0) {
      setPressed(true)
    }
  }

  const releasePress = () => setPressed(false)

  const card = (
    <KanbanCardChrome
      issue={issue}
      statuses={statuses}
      milestones={milestones}
      parentIssueRef={parentIssueRef}
      displayProperties={displayProperties}
      category={category}
      highlighted={highlighted}
      selected={selected}
      runtimeData={runtimeData}
      pressed={pressed}
      dragging={sortable.isDragging}
      onOpenIssue={onOpenIssue}
      onToggleSelected={
        onSelectionGesture ? () => onSelectionGesture(issue.id, 'toggle') : undefined
      }
      onPointerDown={handlePointerDown}
      onPointerUp={releasePress}
      onPointerCancel={releasePress}
      onPointerLeave={releasePress}
      onBlur={releasePress}
    >
      <button
        ref={sortable.handleRef}
        type="button"
        aria-label={`${selected ? 'Selected issue' : 'Open issue'} ${issue.title}`}
        aria-pressed={selected ? true : undefined}
        onClick={handleCardClick}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </KanbanCardChrome>
  )

  return (
    // The sortable ref must sit on the element the column lays out. Registering
    // the inner card instead left this wrapper behind holding its slot while
    // dnd-kit relocated the node inside it, so the board showed the same issue
    // twice and neither copy could be picked up again.
    <div
      ref={sortable.ref}
      data-testid={`issue-sortable-${issue.id}`}
      onMouseEnter={() => onHover?.(issue.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/*
        External items are read-only mirrors of another tracker; the native context
        menu would fire issue mutations against ids the Issue module does not own.
      */}
      {runtimeData || isExternalKanbanIssue(issue)
        ? card
        : (
            <IssueContextMenu
              issue={issue}
              statuses={statuses}
              milestones={milestones}
              onOpen={handleOpenIssue}
            >
              {card}
            </IssueContextMenu>
          )}
    </div>
  )
}

export const KanbanCard = KanbanCardContainer

function KanbanCardChrome({ runtimeData, ...props }: CardChromeProps) {
  if (runtimeData) {
    return <CardView {...props} runtimeData={runtimeData} />
  }

  return <KanbanCardChromeFromHooks {...props} />
}

function KanbanCardChromeFromHooks(props: Omit<CardChromeProps, 'runtimeData'>) {
  const { workspaces } = useWorkspaces()
  const { agents } = useAgents()

  return <CardView {...props} runtimeData={{ workspaces, agents }} />
}

export function KanbanCardPreview({
  issue,
  statuses,
  milestones,
  parentIssueRef,
  displayProperties,
  onOpenIssue,
  category,
  highlighted,
  selected,
  runtimeData,
}: CardProps) {
  return (
    <div data-testid={`issue-drag-preview-${issue.id}`}>
      <KanbanCardChrome
        issue={issue}
        statuses={statuses}
        milestones={milestones}
        parentIssueRef={parentIssueRef}
        displayProperties={displayProperties}
        onOpenIssue={onOpenIssue}
        category={category}
        highlighted={highlighted}
        selected={selected}
        runtimeData={runtimeData}
        preview
      />
    </div>
  )
}

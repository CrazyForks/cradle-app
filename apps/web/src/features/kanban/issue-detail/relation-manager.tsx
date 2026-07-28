import {
  CloseLine as XIcon,
  CopyLine as CopyIcon,
  ForbidCircleLine as ForbidIcon,
  Link2Line as LinkIcon,
  PlusLine as PlusIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Skeleton } from '~/components/ui/skeleton'
import type { KanbanIssue, KanbanIssueRelation } from '~/features/kanban/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { formatIssueId } from '../shared/format-issue-id'
import {
  useAddRelation,
  useDeleteRelation,
  useIssues,
  useRelations,
  useSearchIssues,
} from '../use-kanban'

interface RelationManagerProps {
  issueId: string
  workspaceId: string
  readOnly?: boolean
  onOpenIssue?: (issueId: string) => void
}

type RelationKind = 'blocks' | 'blocked-by' | 'duplicates' | 'duplicated-by' | 'relates-to'

interface RelationKindDef {
  kind: RelationKind
  type: KanbanIssueRelation['type']
  /** Whether the current issue is the source of the underlying edge. */
  outgoing: boolean
  labelKey: 'relation.blocks' | 'relation.blockedBy' | 'relation.duplicates' | 'relation.duplicatedBy' | 'relation.relatesTo'
  icon: typeof ForbidIcon
}

const relationKinds: RelationKindDef[] = [
  { kind: 'blocked-by', type: 'blocks', outgoing: false, labelKey: 'relation.blockedBy', icon: ForbidIcon },
  { kind: 'blocks', type: 'blocks', outgoing: true, labelKey: 'relation.blocks', icon: ForbidIcon },
  { kind: 'duplicates', type: 'duplicates', outgoing: true, labelKey: 'relation.duplicates', icon: CopyIcon },
  { kind: 'duplicated-by', type: 'duplicates', outgoing: false, labelKey: 'relation.duplicatedBy', icon: CopyIcon },
  { kind: 'relates-to', type: 'relates_to', outgoing: true, labelKey: 'relation.relatesTo', icon: LinkIcon },
]

const CANDIDATE_LIMIT = 8

function kindForRelation(relation: KanbanIssueRelation): RelationKindDef {
  const match = relationKinds.find((definition) => {
    if (definition.type !== relation.type) {
      return false
    }
    // `relates_to` is symmetric — the server stores only one edge per pair.
    if (definition.type === 'relates_to') {
      return true
    }
    return definition.outgoing
      ? relation.direction === 'outgoing'
      : relation.direction === 'incoming'
  })
  return match ?? relationKinds.at(-1)!
}

/**
 * Issue relations, Linear-style: existing relations render as a flat chip flow
 * (kind icon + kind label + issue key), and a single `+` entry opens one popover
 * with a kind selector and a plain in-flow search list. The list is self-drawn —
 * no nested portaled combobox, whose outside-click dismissal used to swallow the
 * very pointerdown that was meant to pick a suggestion.
 */
export function RelationManager({
  issueId,
  workspaceId,
  readOnly = false,
  onOpenIssue,
}: RelationManagerProps) {
  const { t } = useTranslation('kanban')
  const { data: relations = [] } = useRelations(issueId, !readOnly)
  const { workspaces } = useWorkspaces()
  const deleteRelation = useDeleteRelation()
  const [addOpen, setAddOpen] = useState(false)

  const chips = relations
    .map(relation => ({ relation, definition: kindForRelation(relation) }))
    .toSorted((left, right) =>
      relationKinds.indexOf(left.definition) - relationKinds.indexOf(right.definition))

  const relatedIssueIds = new Set(
    relations.flatMap(relation => (relation.counterpart ? [relation.counterpart.id] : [])),
  )

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-medium text-muted-foreground">{t('relation.title')}</h3>
        {!readOnly && (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger
              className={cn(
                'flex size-5 items-center justify-center rounded text-muted-foreground',
                'transition-colors hover:bg-fill hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              )}
              aria-label={t('relation.addAria')}
              data-testid="issue-relation-add"
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-2">
              <RelationComposer
                issueId={issueId}
                workspaceId={workspaceId}
                excludedIssueIds={relatedIssueIds}
                onDone={() => setAddOpen(false)}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>

      {chips.length === 0
        ? (
            <p className="text-[12px] text-muted-foreground/60">{t('relation.empty')}</p>
          )
        : (
            <div className="flex flex-wrap gap-1">
              {chips.map(({ relation, definition }) => (
                <RelationChip
                  key={relation.id}
                  relation={relation}
                  definition={definition}
                  workspaces={workspaces}
                  readOnly={readOnly}
                  onOpenIssue={onOpenIssue}
                  onDelete={() => deleteRelation.mutate({ id: relation.id, issueId })}
                />
              ))}
            </div>
          )}
    </div>
  )
}

function RelationChip({
  relation,
  definition,
  workspaces,
  readOnly,
  onOpenIssue,
  onDelete,
}: {
  relation: KanbanIssueRelation
  definition: RelationKindDef
  workspaces: Parameters<typeof formatIssueId>[1]
  readOnly: boolean
  onOpenIssue?: (issueId: string) => void
  onDelete: () => void
}) {
  const { t } = useTranslation('kanban')
  const { counterpart } = relation
  const kindLabel = t(definition.labelKey)
  const Icon = definition.icon
  // An unmet blocker is the state worth surfacing loudly.
  const blocking = definition.kind === 'blocked-by'
  const issueKey = counterpart ? formatIssueId(counterpart, workspaces) : ''

  return (
    <span
      className={cn(
        'group/chip inline-flex h-6 max-w-full items-center overflow-hidden rounded-md border text-[11px]',
        blocking
          ? 'border-destructive/25 bg-destructive/5 text-destructive'
          : 'border-border bg-background text-muted-foreground',
      )}
      data-testid={`issue-relation-chip-${relation.id}`}
    >
      <button
        type="button"
        onClick={() => counterpart && onOpenIssue?.(counterpart.id)}
        disabled={!counterpart || !onOpenIssue}
        title={counterpart ? `${kindLabel} · ${counterpart.title}` : t('relation.missingIssue')}
        aria-label={
          counterpart
            ? `${kindLabel} ${issueKey}: ${counterpart.title}`
            : t('relation.missingIssue')
        }
        className={cn(
          'flex min-w-0 items-center gap-1 px-1.5 py-0.5 transition-colors',
          counterpart && onOpenIssue && 'hover:bg-fill',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        )}
      >
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span className="shrink-0 font-medium">{kindLabel}</span>
        {counterpart
          ? (
              <span className="truncate font-mono tabular-nums text-foreground/80">{issueKey}</span>
            )
          : (
              <span className="truncate italic opacity-70">{t('relation.missingIssue')}</span>
            )}
      </button>
      {!readOnly && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('relation.removeAria', { kind: kindLabel, issue: issueKey })}
          className={cn(
            'flex h-full w-0 items-center justify-center overflow-hidden opacity-0 transition-[width,opacity] duration-100',
            'group-hover/chip:w-5 group-hover/chip:opacity-100',
            'focus-visible:w-5 focus-visible:opacity-100 focus-visible:outline-none',
            blocking ? 'hover:bg-destructive/10' : 'hover:bg-fill hover:text-foreground',
          )}
        >
          <XIcon className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

/**
 * Kind selector + issue search inside a single popover layer.
 * Selecting an issue creates the relation immediately.
 */
function RelationComposer({
  issueId,
  workspaceId,
  excludedIssueIds,
  onDone,
}: {
  issueId: string
  workspaceId: string
  excludedIssueIds: Set<string>
  onDone: () => void
}) {
  const { t } = useTranslation('kanban')
  const { workspaces } = useWorkspaces()
  const [kind, setKind] = useState<RelationKindDef>(relationKinds[0])
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmedQuery = query.trim()
  const { data: workspaceIssues = [], isLoading } = useIssues({ workspaceId })
  const searchIssues = useSearchIssues(trimmedQuery, CANDIDATE_LIMIT, trimmedQuery.length > 0)
  const addRelation = useAddRelation()

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const candidates = (() => {
    const byId = new Map<string, KanbanIssue>()
    const needle = trimmedQuery.toLowerCase()

    const append = (issue: KanbanIssue) => {
      if (issue.id !== issueId && !excludedIssueIds.has(issue.id)) {
        byId.set(issue.id, issue)
      }
    }

    for (const issue of searchIssues.data ?? []) {
      append(issue)
    }
    for (const issue of workspaceIssues) {
      if (!needle) {
        append(issue)
        continue
      }
      const searchable = [formatIssueId(issue, workspaces), String(issue.number), issue.title]
        .join(' ')
        .toLowerCase()
      if (searchable.includes(needle)) {
        append(issue)
      }
    }

    return [...byId.values()].slice(0, CANDIDATE_LIMIT)
  })()

  const highlighted = Math.min(highlightedIndex, Math.max(candidates.length - 1, 0))

  const createRelation = (targetId: string) => {
    // Only a resolved issue can be submitted; there is no free-text path that can
    // reach the API with a non-id string.
    if (!targetId || targetId === issueId || addRelation.isPending) {
      return
    }
    addRelation.mutate(
      {
        sourceIssueId: kind.outgoing ? issueId : targetId,
        targetIssueId: kind.outgoing ? targetId : issueId,
        type: kind.type,
      },
      { onSuccess: onDone },
    )
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex(index => Math.min(index + 1, candidates.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex(index => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const candidate = candidates[highlighted]
      if (candidate) {
        createRelation(candidate.id)
      }
    }
  }

  const loading = isLoading || searchIssues.isFetching

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('relation.title')}>
        {relationKinds.map((definition) => {
          const Icon = definition.icon
          const selected = kind.kind === definition.kind
          return (
            <button
              key={definition.kind}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setKind(definition)
                inputRef.current?.focus()
              }}
              data-testid={`issue-relation-kind-${definition.kind}`}
              className={cn(
                'flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                selected
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-fill hover:text-foreground',
              )}
            >
              <Icon className="size-3" aria-hidden="true" />
              {t(definition.labelKey)}
            </button>
          )
        })}
      </div>

      <div className="flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-1.5">
        <SearchIcon className="size-3 shrink-0 !text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlightedIndex(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('relation.searchPlaceholder')}
          aria-label={t('relation.searchAria', { kind: t(kind.labelKey) })}
          data-testid="issue-relation-search"
          className="min-w-0 flex-1 border-none bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      <div
        className="flex max-h-56 flex-col gap-px overflow-y-auto"
        role="listbox"
        aria-label={t(kind.labelKey)}
      >
        {loading && <Skeleton className="h-9 w-full" />}
        {!loading && candidates.length === 0 && (
          <div className="px-1.5 py-4 text-center text-[12px] text-muted-foreground">
            {t('relation.noResults')}
          </div>
        )}
        {!loading
          && candidates.map((issue, index) => (
            <button
              key={issue.id}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              disabled={addRelation.isPending}
              onClick={() => createRelation(issue.id)}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={cn(
                'flex items-start gap-1.5 rounded px-1.5 py-1 text-left transition-colors',
                'disabled:pointer-events-none disabled:opacity-50',
                index === highlighted ? 'bg-fill' : 'hover:bg-fill',
              )}
            >
              <span className="mt-px shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                {formatIssueId(issue, workspaces)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                {issue.title}
              </span>
            </button>
          ))}
      </div>
    </div>
  )
}

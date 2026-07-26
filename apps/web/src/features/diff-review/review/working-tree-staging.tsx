import {
  CheckLine as CheckIcon,
  Delete2Line as DiscardIcon,
} from '@mingcute/react'

import { cn } from '~/lib/cn'

import { ChangeBar } from './review-primitives'
import type { WorkingTreeFile } from './working-tree-model'

const STATUS_LETTER: Record<WorkingTreeFile['status'], string> = {
  added: 'A',
  untracked: 'U',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
}

const STATUS_COLOR: Record<WorkingTreeFile['status'], string> = {
  added: 'text-[var(--rv-add)]',
  untracked: 'text-[var(--rv-add)]',
  modified: 'text-[var(--rv-warn)]',
  deleted: 'text-[var(--rv-del)]',
  renamed: 'text-[var(--rv-accent)]',
}

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

/**
 * A checkbox that stages or unstages a file. The checkbox *is* the stage action
 * — there is no separate "stage" button — so the primary thing you do on this
 * page (choose what goes into the commit) is the most direct gesture available.
 */
function StageBox({ staged, onToggle, label }: {
  staged: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={staged}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      className={cn(
        'inline-flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-100',
        staged
          ? 'border-[var(--rv-accent)] bg-[var(--rv-accent)] text-[var(--rv-accent-fg)]'
          : 'border-[var(--rv-edge)] text-transparent hover:border-[var(--rv-fg-muted)]',
      )}
    >
      <CheckIcon className="size-2.5" aria-hidden />
    </button>
  )
}

function FileRow({ file, selected, onSelect, onToggleStage, onDiscard }: {
  file: WorkingTreeFile
  selected: boolean
  onSelect: () => void
  onToggleStage: () => void
  onDiscard?: () => void
}) {
  const directory = dirname(file.path)
  return (
    <li>
      <div
        className={cn(
          'group/wt relative flex h-[28px] items-center gap-2 pl-3 pr-2 transition-colors duration-100',
          selected ? 'bg-[var(--rv-bg-active)]' : 'hover:bg-[var(--rv-bg-hover)]',
        )}
      >
        {selected && (
          <span
            aria-hidden
            className="absolute inset-y-[4px] left-0 w-[2px] rounded-r-full bg-[var(--rv-accent)]"
          />
        )}

        <StageBox
          staged={file.staged}
          onToggle={onToggleStage}
          label={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
        />

        <span
          aria-label={file.status}
          className={cn(
            'w-[9px] shrink-0 text-center font-[var(--rv-font-mono)] text-[10.5px] font-semibold',
            STATUS_COLOR[file.status],
          )}
        >
          {STATUS_LETTER[file.status]}
        </span>

        <button
          type="button"
          onClick={onSelect}
          title={file.path}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
        >
          <span
            className={cn(
              'shrink-0 truncate text-[12px] leading-none',
              selected ? 'text-[var(--rv-fg)]' : 'text-[var(--rv-fg-muted)] group-hover/wt:text-[var(--rv-fg)]',
            )}
          >
            {basename(file.path)}
          </span>
          {directory && (
            <span className="min-w-0 truncate font-[var(--rv-font-mono)] text-[10px] text-[var(--rv-fg-subtle)]">
              {directory}
            </span>
          )}
        </button>

        {!file.isBinary && (
          <ChangeBar
            additions={file.additions}
            deletions={file.deletions}
            className="shrink-0 opacity-70 group-hover/wt:opacity-0"
          />
        )}

        {onDiscard && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onDiscard()
            }}
            title={`Discard changes in ${file.path}`}
            aria-label={`Discard changes in ${file.path}`}
            className={cn(
              'absolute right-2 inline-flex size-[18px] shrink-0 items-center justify-center rounded-[4px]',
              'text-[var(--rv-fg-subtle)] opacity-0 transition-colors duration-100',
              'group-hover/wt:opacity-100 hover:bg-[var(--rv-bg-active)] hover:text-[var(--rv-danger)]',
            )}
          >
            <DiscardIcon className="size-3" aria-hidden />
          </button>
        )}
      </div>
    </li>
  )
}

export interface StagingGroupProps {
  title: string
  files: WorkingTreeFile[]
  selectedFileId: string | null
  onSelectFile: (file: WorkingTreeFile) => void
  onToggleStage: (file: WorkingTreeFile) => void
  onDiscard?: (file: WorkingTreeFile) => void
  /** "Stage all" / "Unstage all" applied to this whole group. */
  onBulk?: () => void
  bulkLabel?: string
}

/**
 * One stage bucket — Staged or Unstaged. Splitting the file list by stage state
 * (rather than one flat list with checkboxes scattered through it) is what makes
 * "what am I about to commit" legible at a glance.
 */
export function StagingGroup({
  title,
  files,
  selectedFileId,
  onSelectFile,
  onToggleStage,
  onDiscard,
  onBulk,
  bulkLabel,
}: StagingGroupProps) {
  if (files.length === 0) {
    return null
  }
  return (
    <section>
      <div
        className={cn(
          'sticky top-0 z-10 flex h-7 items-center justify-between gap-2 bg-[var(--rv-bg-subtle)] px-3',
          'text-[10.5px] font-medium uppercase tracking-[0.055em] text-[var(--rv-fg-subtle)]',
        )}
      >
        <span className="flex items-center gap-1.5">
          {title}
          <span data-rv-num className="text-[var(--rv-fg-subtle)]">{files.length}</span>
        </span>
        {onBulk && bulkLabel && (
          <button
            type="button"
            onClick={onBulk}
            className="rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-medium normal-case tracking-normal text-[var(--rv-accent)] hover:bg-[var(--rv-bg-hover)]"
          >
            {bulkLabel}
          </button>
        )}
      </div>
      <ul role="list">
        {files.map(file => (
          <FileRow
            key={file.id}
            file={file}
            selected={file.id === selectedFileId}
            onSelect={() => onSelectFile(file)}
            onToggleStage={() => onToggleStage(file)}
            onDiscard={onDiscard ? () => onDiscard(file) : undefined}
          />
        ))}
      </ul>
    </section>
  )
}

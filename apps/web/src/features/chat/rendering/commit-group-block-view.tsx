import {
  Chat1Line as AddToChatIcon,
  GitCommitLine as GitCommitIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { cn } from '~/lib/cn'

export interface CommitGroupData {
  message?: string
  files?: string
  body?: string
}

export interface CommitGroupBlockViewProps extends CommitGroupData {
  fileLinks?: ReactNode
  onAddToComposer?: (group: CommitGroupData) => void
}

/** Parses the comma-separated `files` attribute into trimmed paths. */
export function parseCommitGroupFiles(files?: string): string[] {
  if (!files) {
    return []
  }
  return files
    .split(',')
    .map(path => path.trim())
    .filter(Boolean)
}

/** Fixture-driven presentation for a proposed commit group. */
export function CommitGroupBlockView({
  message,
  files,
  body,
  fileLinks,
  onAddToComposer,
  ...group
}: CommitGroupBlockViewProps) {
  const fileCount = parseCommitGroupFiles(files).length
  const [filesOpen, setFilesOpen] = useState(false)

  return (
    <section className="my-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 shadow-xs">
      <div className="flex min-w-0 items-center gap-1.5">
        <GitCommitIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
          {message ?? 'Commit group'}
        </span>
        {onAddToComposer
          ? (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                title="Append a commit prompt for this group to the composer"
                onClick={() => onAddToComposer({ message, body, files, ...group })}
              >
                <AddToChatIcon className="size-3" aria-hidden="true" />
                Add to Chat
              </Button>
            )
          : null}
      </div>
      {fileLinks && fileCount > 0
        ? (
            <Collapsible open={filesOpen} onOpenChange={setFilesOpen} className="mt-1">
              <CollapsibleTrigger
                className={cn(
                  'flex w-full items-center gap-1 rounded px-1 py-0.5 -mx-1',
                  'text-[11px] text-muted-foreground transition-colors hover:bg-fill hover:text-foreground',
                )}
              >
                <ChevronRightIcon
                  className={cn('size-3 shrink-0 transition-transform duration-200', filesOpen && 'rotate-90')}
                  aria-hidden="true"
                />
                {fileCount}
                {' '}
                {fileCount === 1 ? 'file' : 'files'}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-0.5 flex max-h-48 flex-col gap-0.5 overflow-y-auto border-l border-border/60 pl-2.5 ml-0.5 text-[11px] text-muted-foreground">
                  {fileLinks}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )
        : null}
      {body ? <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{body}</p> : null}
    </section>
  )
}

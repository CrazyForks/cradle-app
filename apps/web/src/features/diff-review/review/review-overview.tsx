import {
  CheckLine as CheckIcon,
  CloseLine as FailIcon,
  GitBranchLine as BranchIcon,
  LoadingLine as RunningIcon,
  UpLine as CollapseIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'

import { cn } from '~/lib/cn'

import type { CradleDiffReview } from '../shared/types'
import { ChangeStat, Pill, StatusDot } from './review-primitives'
import {
  formatRelativeTime,
  reviewBranches,
  reviewChecks,
  reviewIdentity,
  reviewStatusBadge,
} from './review-summary'

/**
 * A labelled fact in the metadata strip. Label above value, not beside it —
 * scanning down a row of these is faster than parsing `Label: value` pairs.
 */
function Fact({ label, children }: { label: string, children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.055em] text-[var(--rv-fg-subtle)]">
        {label}
      </span>
      <div className="min-w-0 text-[12px] text-[var(--rv-fg)]">{children}</div>
    </div>
  )
}

function BranchPair({ base, head }: { base: string, head: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-[var(--rv-font-mono)] text-[11.5px]">
      <BranchIcon className="size-3 shrink-0 text-[var(--rv-fg-subtle)]" aria-hidden />
      <span className="truncate text-[var(--rv-fg)]" title={head}>{head}</span>
      <span className="shrink-0 text-[var(--rv-fg-subtle)]" aria-label="into">→</span>
      <span className="truncate text-[var(--rv-fg-muted)]" title={base}>{base}</span>
    </span>
  )
}

export interface ReviewOverviewProps {
  review: CradleDiffReview
  collapsed: boolean
  onToggleCollapsed: () => void
}

/**
 * The review's headline band: what this change is, who it is from, and whether
 * it is safe to merge — everything a reviewer needs *before* reading a single
 * line of diff.
 *
 * Collapses to nothing (the top bar keeps the title) because on a second pass
 * through a diff this context is dead weight.
 */
export function ReviewOverview({ review, collapsed, onToggleCollapsed }: ReviewOverviewProps) {
  const identity = reviewIdentity(review)
  const status = reviewStatusBadge(review)
  const branches = reviewBranches(review)
  const checks = reviewChecks(review)
  const detail = review.githubPullRequest?.detail
  const revision = review.currentRevision
  const description = detail?.body?.trim() || null
  const openThreads = review.threads.filter(thread => thread.state !== 'resolved').length

  if (collapsed) {
    return null
  }

  return (
    <section
      className="shrink-0 border-b border-[var(--rv-line)] bg-[var(--rv-bg)]"
      aria-label="Review overview"
    >
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <h1
              className="text-balance text-[19px] font-semibold leading-[1.25] tracking-[-0.014em] text-[var(--rv-fg)]"
            >
              {identity.title}
            </h1>

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11.5px] text-[var(--rv-fg-muted)]">
              <Pill tone={status.tone} icon={<StatusDot tone={status.tone} filled={status.filled} />}>
                {status.label}
              </Pill>
              {revision && (
                <>
                  <ChangeStat additions={revision.additions} deletions={revision.deletions} />
                  <span aria-hidden className="text-[var(--rv-fg-subtle)]">·</span>
                  <span data-rv-num>
                    {revision.fileCount}
                    {revision.fileCount === 1 ? ' file' : ' files'}
                  </span>
                </>
              )}
              {detail?.author?.login && (
                <>
                  <span aria-hidden className="text-[var(--rv-fg-subtle)]">·</span>
                  <span>{detail.author.login}</span>
                </>
              )}
              <span aria-hidden className="text-[var(--rv-fg-subtle)]">·</span>
              <span title={new Date(review.updatedAt * 1000).toLocaleString()}>
                updated
                {' '}
                {formatRelativeTime(review.updatedAt)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleCollapsed}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--rv-radius)] px-2',
              'text-[11.5px] text-[var(--rv-fg-muted)] transition-colors duration-100',
              'hover:bg-[var(--rv-bg-hover)] hover:text-[var(--rv-fg)]',
            )}
          >
            <CollapseIcon className="size-3.5" aria-hidden />
            Hide details
          </button>
        </div>

        {description && (
          <p
            className={cn(
              'max-w-[68ch] whitespace-pre-wrap text-[13px] leading-[1.6] text-[var(--rv-fg-muted)]',
              'line-clamp-6',
            )}
          >
            {description}
          </p>
        )}

        <div
          className={cn(
            'grid gap-x-6 gap-y-4 border-t border-[var(--rv-line)] pt-4',
            'grid-cols-[repeat(auto-fit,minmax(140px,1fr))]',
          )}
        >
          {branches && (
            <Fact label="Branch">
              <BranchPair base={branches.base} head={branches.head} />
            </Fact>
          )}

          {checks && (
            <Fact label="Checks">
              <span className="flex items-center gap-1.5">
                {checks.failed > 0
                  ? <FailIcon className="size-3.5 text-[var(--rv-danger)]" aria-hidden />
                  : checks.pending > 0
                    ? <RunningIcon className="size-3.5 animate-spin text-[var(--rv-warn)]" aria-hidden />
                    : <CheckIcon className="size-3.5 text-[var(--rv-open)]" aria-hidden />}
                <span className="text-[11.5px]">{checks.label}</span>
                <span data-rv-num className="text-[11.5px] text-[var(--rv-fg-subtle)]">
                  {checks.passed}
                  /
                  {checks.total}
                </span>
              </span>
            </Fact>
          )}

          {detail && detail.reviewers.length > 0 && (
            <Fact label="Reviewers">
              <span className="truncate text-[11.5px]">
                {detail.reviewers.map(reviewer => reviewer.login).join(', ')}
              </span>
            </Fact>
          )}

          <Fact label="Threads">
            <span data-rv-num className="text-[11.5px]">
              {openThreads > 0
                ? `${openThreads} open`
                : review.threads.length > 0
                  ? 'All resolved'
                  : 'None'}
            </span>
          </Fact>

          {detail && detail.labels.length > 0 && (
            <Fact label="Labels">
              <span className="flex flex-wrap gap-1">
                {detail.labels.map(label => (
                  <span
                    key={label.name}
                    className={cn(
                      'inline-flex h-[18px] items-center gap-1 rounded-[4px] px-1.5',
                      'border border-[var(--rv-line)] text-[10.5px] text-[var(--rv-fg-muted)]',
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-[6px] rounded-full"
                      style={{ background: `#${label.color}` }}
                    />
                    {label.name}
                  </span>
                ))}
              </span>
            </Fact>
          )}
        </div>
      </div>
    </section>
  )
}

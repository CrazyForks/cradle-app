import type { CradleDiffReview } from '../shared/types'
import type { ReviewStatusTone } from './review-primitives'

/**
 * Pure derivations behind the review header.
 *
 * A review's headline facts are assembled from three different places depending
 * on where it came from (the review row, the GitHub snapshot, the revision), and
 * every surface that shows a review needs the same answer. Deriving it here
 * keeps that reconciliation in one testable place instead of re-deciding it in
 * each component.
 */

export interface ReviewIdentity {
  /** `owner/repo` for a pull request, otherwise the local repository name. */
  repositoryLabel: string
  /** `#87` for a pull request; null when the source has no external number. */
  reference: string | null
  /** Human title with any redundant `owner/repo#n ` prefix stripped. */
  title: string
  hostKind: 'github' | 'local'
}

export interface ReviewStatusBadge {
  tone: ReviewStatusTone
  label: string
  /** Terminal states render hollow so live work reads louder in a list. */
  filled: boolean
}

export interface ReviewChecks {
  passed: number
  failed: number
  pending: number
  total: number
  tone: ReviewStatusTone
  label: string
}

function repositoryName(repositoryPath: string): string {
  const trimmed = repositoryPath.replace(/\/+$/, '')
  if (trimmed === '.' || trimmed === '') {
    return 'Local repository'
  }
  const index = trimmed.lastIndexOf('/')
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

export function reviewIdentity(review: CradleDiffReview): ReviewIdentity {
  const pullRequest = review.githubPullRequest
  if (pullRequest) {
    const repositoryLabel = `${pullRequest.owner}/${pullRequest.repo}`
    const reference = `#${pullRequest.number}`
    const prefix = `${repositoryLabel}${reference} `
    return {
      repositoryLabel,
      reference,
      title: pullRequest.detail?.title
        ?? (review.title.startsWith(prefix) ? review.title.slice(prefix.length) : review.title),
      hostKind: 'github',
    }
  }
  return {
    repositoryLabel: repositoryName(review.repositoryPath),
    reference: null,
    title: review.title,
    hostKind: 'local',
  }
}

export function reviewStatusBadge(review: CradleDiffReview): ReviewStatusBadge {
  if (review.githubPullRequest?.detail?.isDraft && review.status === 'open') {
    return { tone: 'draft', label: 'Draft', filled: false }
  }
  if (review.status === 'merged') {
    return { tone: 'merged', label: 'Merged', filled: true }
  }
  if (review.status === 'closed') {
    return { tone: 'closed', label: 'Closed', filled: false }
  }
  if (review.status === 'abandoned') {
    return { tone: 'closed', label: 'Abandoned', filled: false }
  }
  if (review.reviewState === 'changes-requested') {
    return { tone: 'warn', label: 'Changes requested', filled: true }
  }
  if (review.reviewState === 'approved') {
    return { tone: 'open', label: 'Approved', filled: true }
  }
  return { tone: 'open', label: 'Open', filled: true }
}

export function reviewBranches(review: CradleDiffReview): { base: string, head: string } | null {
  const detail = review.githubPullRequest?.detail
  if (detail) {
    return { base: detail.baseRef, head: detail.headRef }
  }
  return null
}

export function reviewChecks(review: CradleDiffReview): ReviewChecks | null {
  const checks = review.githubPullRequest?.detail?.checks
  if (!checks || checks.length === 0) {
    return null
  }
  let passed = 0
  let failed = 0
  let pending = 0
  for (const check of checks) {
    if (check.status !== 'completed') {
      pending += 1
    }
    else if (check.conclusion === 'success' || check.conclusion === 'neutral' || check.conclusion === 'skipped') {
      passed += 1
    }
    else {
      failed += 1
    }
  }
  const tone: ReviewStatusTone = failed > 0 ? 'danger' : pending > 0 ? 'warn' : 'open'
  const label = failed > 0
    ? `${failed} failing`
    : pending > 0
      ? `${pending} running`
      : 'All checks passed'
  return { passed, failed, pending, total: checks.length, tone, label }
}

/** `2 minutes ago` — relative time is what a reviewer actually needs to judge freshness. */
export function formatRelativeTime(seconds: number, now: number = Date.now()): string {
  const deltaSeconds = Math.round(now / 1000 - seconds)
  if (deltaSeconds < 45) {
    return 'just now'
  }
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, unitSeconds] of units) {
    if (Math.abs(deltaSeconds) >= unitSeconds) {
      return formatter.format(-Math.round(deltaSeconds / unitSeconds), unit)
    }
  }
  return formatter.format(-deltaSeconds, 'second')
}

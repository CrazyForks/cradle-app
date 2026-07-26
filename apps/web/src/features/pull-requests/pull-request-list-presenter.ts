import type { CradlePullRequest, PullRequestRole } from './use-pull-requests'

export type PullRequestFilter = 'all' | PullRequestRole
export type PullRequestStateFilter = 'all' | PullRequestState
export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed'
export type PullRequestRecencyGroupId = 'today' | 'yesterday' | 'thisWeek' | 'earlier'

export interface PullRequestRecencyGroup {
  id: PullRequestRecencyGroupId
  items: CradlePullRequest[]
}

export interface PullRequestRepositoryOption {
  id: string
  count: number
  avatarUrl: string
}

export const PULL_REQUEST_FILTERS: PullRequestFilter[] = ['all', 'reviewing', 'authored']
export const PULL_REQUEST_STATE_FILTERS: PullRequestStateFilter[] = [
  'all',
  'open',
  'draft',
  'merged',
  'closed',
]

const RECENCY_GROUP_ORDER: PullRequestRecencyGroupId[] = [
  'today',
  'yesterday',
  'thisWeek',
  'earlier',
]

export function matchesPullRequestFilter(
  item: CradlePullRequest,
  filter: PullRequestFilter,
): boolean {
  return filter === 'all' || item.role === filter
}

export function getPullRequestState(item: CradlePullRequest): PullRequestState {
  const pullRequest = item.pullRequest
  if (pullRequest.merged) {
    return 'merged'
  }
  if (pullRequest.state === 'closed') {
    return 'closed'
  }
  return pullRequest.isDraft ? 'draft' : 'open'
}

export function matchesPullRequestState(
  item: CradlePullRequest,
  filter: PullRequestStateFilter,
): boolean {
  return filter === 'all' || getPullRequestState(item) === filter
}

export function getPullRequestRepositoryId(item: CradlePullRequest): string {
  return `${item.pullRequest.owner}/${item.pullRequest.repo}`
}

export function matchesPullRequestRepository(
  item: CradlePullRequest,
  repository: string | null,
): boolean {
  return repository === null || getPullRequestRepositoryId(item) === repository
}

export function listPullRequestRepositories(
  items: CradlePullRequest[],
): PullRequestRepositoryOption[] {
  type RepositoryCount = { id: string, count: number, avatarUrl: string }
  const counts = new Map<string, RepositoryCount>()
  for (const item of items) {
    const id = getPullRequestRepositoryId(item)
    const avatarUrl = `https://github.com/${item.pullRequest.owner}.png?size=32`
    const existing = counts.get(id)
    if (existing) {
      existing.count += 1
    }
    else {
      counts.set(id, { id, count: 1, avatarUrl })
    }
  }
  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
}

export function matchesPullRequestSearch(
  item: CradlePullRequest,
  query: string,
): boolean {
  if (!query) {
    return true
  }

  const pullRequest = item.pullRequest
  return [
    pullRequest.title,
    pullRequest.owner,
    pullRequest.repo,
    pullRequest.headRef,
    pullRequest.baseRef,
    String(pullRequest.number),
  ].some(value => value.toLocaleLowerCase().includes(query))
}

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function getRecencyGroupId(
  updatedAtSeconds: number,
  nowMs: number,
): PullRequestRecencyGroupId {
  const diffDays = Math.floor(
    (startOfDay(nowMs) - startOfDay(updatedAtSeconds * 1000)) / 86_400_000,
  )
  if (diffDays <= 0) {
    return 'today'
  }
  if (diffDays === 1) {
    return 'yesterday'
  }
  if (diffDays <= 7) {
    return 'thisWeek'
  }
  return 'earlier'
}

export function groupPullRequestsByRecency(
  items: CradlePullRequest[],
  nowMs: number,
): PullRequestRecencyGroup[] {
  const sorted = [...items].sort(
    (left, right) => right.pullRequest.updatedAt - left.pullRequest.updatedAt,
  )
  const buckets = new Map<PullRequestRecencyGroupId, CradlePullRequest[]>()

  for (const item of sorted) {
    const id = getRecencyGroupId(item.pullRequest.updatedAt, nowMs)
    const bucket = buckets.get(id)
    if (bucket) {
      bucket.push(item)
    }
    else {
      buckets.set(id, [item])
    }
  }

  return RECENCY_GROUP_ORDER
    .map(id => ({ id, items: buckets.get(id) ?? [] }))
    .filter(group => group.items.length > 0)
}

export function formatPullRequestDate(
  timestamp: number,
  locale: string,
  nowMs: number,
): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp * 1000).getFullYear() === new Date(nowMs).getFullYear()
      ? undefined
      : 'numeric',
  }).format(timestamp * 1000)
}

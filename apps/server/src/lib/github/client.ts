import { throttling } from '@octokit/plugin-throttling'
import { RequestError } from '@octokit/request-error'
import { Octokit } from 'octokit'

import { resolveGitHubToken } from '../github-api-token'

const GITHUB_REQUEST_TIMEOUT_MS = 20_000
/** Below this remaining budget, non-force GETs must not hit the network. */
export const GITHUB_RATE_LIMIT_SOFT_FLOOR = 500

const CradleOctokit = Octokit.plugin(throttling)

let rateLimitRemaining = 5000
let rateLimitReset = 0
let cachedOctokit: InstanceType<typeof CradleOctokit> | null = null
let cachedOctokitToken: string | null | undefined

export { RequestError }

export function recordGitHubRateLimit(headers: Headers | Record<string, string | number | undefined> | undefined): void {
  if (!headers) {
    return
  }
  const remaining = headers instanceof Headers
    ? headers.get('x-ratelimit-remaining') ?? headers.get('X-RateLimit-Remaining')
    : String(headers['x-ratelimit-remaining'] ?? headers['X-RateLimit-Remaining'] ?? '')
  const reset = headers instanceof Headers
    ? headers.get('x-ratelimit-reset') ?? headers.get('X-RateLimit-Reset')
    : String(headers['x-ratelimit-reset'] ?? headers['X-RateLimit-Reset'] ?? '')
  if (remaining) {
    const parsed = Number.parseInt(remaining, 10)
    if (Number.isFinite(parsed)) {
      rateLimitRemaining = parsed
    }
  }
  if (reset) {
    const parsed = Number.parseInt(reset, 10)
    if (Number.isFinite(parsed)) {
      rateLimitReset = parsed
    }
  }
}

export function getGitHubRateLimitRemaining(): number {
  return rateLimitRemaining
}

export function isGitHubRateLimited(): boolean {
  if (rateLimitRemaining > GITHUB_RATE_LIMIT_SOFT_FLOOR) {
    return false
  }
  const now = Math.floor(Date.now() / 1000)
  return now < rateLimitReset
}

/** True when we should avoid discretionary network GETs and serve stale cache. */
export function shouldAvoidGitHubNetwork(): boolean {
  return rateLimitRemaining <= GITHUB_RATE_LIMIT_SOFT_FLOOR
}

export function resetGitHubClientState(): void {
  rateLimitRemaining = 5000
  rateLimitReset = 0
  cachedOctokit = null
  cachedOctokitToken = undefined
}

export function getOctokit(options?: { requireToken?: boolean }): InstanceType<typeof CradleOctokit> {
  const token = resolveGitHubToken()
  if (options?.requireToken && !token) {
    throw new RequestError(
      'GitHub authentication required. Set GH_TOKEN / GITHUB_TOKEN or run `gh auth login`.',
      401,
      { request: { method: 'GET', url: 'https://api.github.com', headers: {} } },
    )
  }

  if (cachedOctokit && cachedOctokitToken === token) {
    return cachedOctokit
  }

  cachedOctokitToken = token
  cachedOctokit = new CradleOctokit({
    auth: token ?? undefined,
    request: {
      timeout: GITHUB_REQUEST_TIMEOUT_MS,
    },
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit, retryCount) => {
        if (retryCount < 2) {
          return true
        }
        return false
      },
      onSecondaryRateLimit: (retryAfter, _options, _octokit, retryCount) => {
        if (retryCount < 2) {
          return true
        }
        return false
      },
    },
  })
  return cachedOctokit
}

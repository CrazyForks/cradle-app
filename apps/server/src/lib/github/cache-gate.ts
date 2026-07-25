import type { CachedFetchResult } from '../github-cache'
import {
  cachedFetch as baseCachedFetch,
  getCached,
  isCacheStale,
  setCache,
  touchCache,
} from '../github-cache'
import {
  getOctokit,
  isGitHubRateLimited,
  recordGitHubRateLimit,
  RequestError,
  shouldAvoidGitHubNetwork,
} from './client'

export type GitHubReadMode = 'read' | 'probe' | 'force'

export interface GitHubCachedReadOptions<T> {
  cacheKey: string
  ttlS?: number
  /** When true (default), send If-None-Match on revalidation. */
  etag?: boolean
  mode?: GitHubReadMode
  /**
   * Perform the network fetch. Receive the stored ETag (if any).
   * Return status 304 when GitHub reports Not Modified.
   */
  fetcher: (etag: string | null) => Promise<CachedFetchResult<T>>
}

const inFlight = new Map<string, Promise<unknown>>()

/**
 * Cache-first GitHub read gate:
 * - fresh TTL hit → zero network
 * - stale hit → return stale immediately; background ETag revalidate (SWR)
 * - miss → sync fetch (unless budget is low)
 * - force → sync conditional fetch
 * - probe → like force but callers should use a cheap fingerprint resource
 */
export async function cachedGitHubRead<T>(options: GitHubCachedReadOptions<T>): Promise<T | null> {
  const {
    cacheKey,
    ttlS = 60,
    etag = true,
    mode = 'read',
    fetcher,
  } = options

  const cached = getCached<T>(cacheKey)
  const fresh = cached && !isCacheStale(cacheKey, ttlS)

  if (mode === 'read' && fresh) {
    return cached.data
  }

  if (mode === 'read' && cached && shouldAvoidGitHubNetwork()) {
    return cached.data
  }

  if (mode === 'read' && cached && !fresh) {
    // Stale-while-revalidate: serve immediately, refresh in background.
    void coalesce(cacheKey, async () => {
      await revalidate(cacheKey, etag, fetcher)
    })
    return cached.data
  }

  if (shouldAvoidGitHubNetwork() && mode !== 'force' && cached) {
    return cached.data
  }

  if (shouldAvoidGitHubNetwork() && mode !== 'force' && !cached) {
    return null
  }

  return coalesce(cacheKey, async () => revalidate(cacheKey, etag, fetcher))
}

async function revalidate<T>(
  cacheKey: string,
  useEtag: boolean,
  fetcher: (etag: string | null) => Promise<CachedFetchResult<T>>,
): Promise<T | null> {
  const existingEtag = useEtag ? getCached(cacheKey)?.etag ?? null : null
  const result = await fetcher(existingEtag)

  if (result.status === 304) {
    touchCache(cacheKey)
    return getCached<T>(cacheKey)?.data ?? null
  }

  if (result.data === null) {
    return getCached<T>(cacheKey)?.data ?? null
  }

  setCache(cacheKey, result.data, result.etag ?? null)
  return result.data
}

function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) {
    return existing
  }
  const promise = run().finally(() => {
    if (inFlight.get(key) === promise) {
      inFlight.delete(key)
    }
  })
  inFlight.set(key, promise)
  return promise
}

export function clearGitHubReadInFlight(): void {
  inFlight.clear()
}

/** Thin wrapper kept for callers that still use the older cachedFetch shape. */
export async function cachedFetch<T>(options: {
  cacheKey: string
  ttlS?: number
  etag?: boolean
  fetcher: (etag: string | null) => Promise<CachedFetchResult<T>>
}): Promise<T | null> {
  return cachedGitHubRead({ ...options, mode: 'read' })
}

export async function octokitRestGet<T>(input: {
  route: string
  params?: Record<string, unknown>
  etag?: string | null
  schema: { parse: (data: unknown) => T }
  requireToken?: boolean
}): Promise<CachedFetchResult<T>> {
  const octokit = getOctokit({ requireToken: input.requireToken })
  try {
    const response = await octokit.request(input.route as `${string} ${string}`, {
      ...input.params,
      headers: input.etag
        ? { 'If-None-Match': input.etag }
        : undefined,
    })
    recordGitHubRateLimit(response.headers as Record<string, string | number | undefined>)
    const etagHeader = response.headers.etag ?? response.headers.ETag
    return {
      data: input.schema.parse(response.data),
      etag: typeof etagHeader === 'string' ? etagHeader : null,
      status: response.status,
    }
  }
  catch (error) {
    if (error instanceof RequestError) {
      recordGitHubRateLimit(error.response?.headers as Record<string, string | number | undefined> | undefined)
      if (error.status === 304) {
        return { data: null, etag: null, status: 304 }
      }
    }
    throw error
  }
}

export { baseCachedFetch, isGitHubRateLimited, shouldAvoidGitHubNetwork }

import { githubApiCache } from '@cradle/db'
import { eq, inArray, lt } from 'drizzle-orm'

import { db } from '../infra'
import * as Maintenance from '../modules/maintenance/service'

const DEFAULT_TTL_S = 60 * 60 // 1 hour

export function getCached<T>(key: string): { data: T, etag: string | null } | null {
  const row = db().select().from(githubApiCache).where(eq(githubApiCache.cacheKey, key)).get()
  if (!row) {
    return null
  }
  return {
    data: JSON.parse(row.dataJson) as T,
    etag: row.etag,
  }
}

export function isCacheStale(key: string, ttlS = DEFAULT_TTL_S): boolean {
  const row = db().select({ fetchedAt: githubApiCache.fetchedAt }).from(githubApiCache).where(eq(githubApiCache.cacheKey, key)).get()
  if (!row) {
    return true
  }
  const now = Math.floor(Date.now() / 1000)
  return (now - row.fetchedAt) > ttlS
}

export function setCache(key: string, data: unknown, etag?: string | null): void {
  const now = Math.floor(Date.now() / 1000)
  db().insert(githubApiCache).values({
    cacheKey: key,
    dataJson: JSON.stringify(data),
    etag: etag ?? null,
    fetchedAt: now,
  }).onConflictDoUpdate({
    target: githubApiCache.cacheKey,
    set: {
      dataJson: JSON.stringify(data),
      etag: etag ?? null,
      fetchedAt: now,
    },
  }).run()
}

/** Renew freshness without rewriting payload (e.g. HTTP 304). */
export function touchCache(key: string): void {
  const now = Math.floor(Date.now() / 1000)
  const row = db().select().from(githubApiCache).where(eq(githubApiCache.cacheKey, key)).get()
  if (!row) {
    return
  }
  db().insert(githubApiCache).values({
    cacheKey: key,
    dataJson: row.dataJson,
    etag: row.etag,
    fetchedAt: now,
  }).onConflictDoUpdate({
    target: githubApiCache.cacheKey,
    set: { fetchedAt: now },
  }).run()
}

export function deleteCache(key: string): void {
  db().delete(githubApiCache).where(eq(githubApiCache.cacheKey, key)).run()
}

export function deleteCachePrefix(prefix: string): void {
  const rows = db().select({ key: githubApiCache.cacheKey }).from(githubApiCache).all()
  for (const row of rows) {
    if (row.key.startsWith(prefix)) {
      db().delete(githubApiCache).where(eq(githubApiCache.cacheKey, row.key)).run()
    }
  }
}

export interface CachedFetchResult<T> {
  data: T | null
  etag?: string | null
  status: number
}

export interface CachedFetchOptions<T> {
  cacheKey: string
  ttlS?: number
  etag?: boolean
  fetcher: (etag: string | null) => Promise<CachedFetchResult<T>>
}

export async function cachedFetch<T>(options: CachedFetchOptions<T>): Promise<T | null> {
  const { cacheKey, ttlS = 60, etag = true, fetcher } = options

  if (!isCacheStale(cacheKey, ttlS)) {
    const cached = getCached<T>(cacheKey)
    if (cached) { return cached.data }
  }

  const existingEtag = etag ? getCached(cacheKey)?.etag ?? null : null
  const result = await fetcher(existingEtag)

  if (result.status === 304) {
    const cached = getCached<T>(cacheKey)
    return cached?.data ?? null
  }

  if (result.data === null) {
    return null
  }

  setCache(cacheKey, result.data, result.etag ?? null)
  return result.data
}

export function pruneStaleCache(
  ttlS = DEFAULT_TTL_S * 24,
  limit = 250,
  now = Math.floor(Date.now() / 1000),
): number {
  return db().transaction((tx) => {
    const keys = tx
      .select({ key: githubApiCache.cacheKey })
      .from(githubApiCache)
      .where(lt(githubApiCache.fetchedAt, now - ttlS))
      .limit(limit)
      .all()
      .map(row => row.key)
    if (keys.length === 0) {
      return 0
    }
    return tx.delete(githubApiCache).where(inArray(githubApiCache.cacheKey, keys)).run().changes
  })
}

export function registerGithubCacheMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'github-cache',
    key: 'prune-stale',
    title: 'Prune stale GitHub cache',
    intervalMs: 60 * 60 * 1000,
    runOnStart: true,
    manuallyRunnable: true,
    run: ({ now }) => ({ pruned: pruneStaleCache(DEFAULT_TTL_S * 24, 250, Math.floor(now / 1000)) }),
  })
}

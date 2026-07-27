import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { githubApiCache } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../infra'
import { pruneStaleCache } from './github-cache'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-github-cache-'))
  process.env.CRADLE_DATA_DIR = dataDir
})

afterEach(() => {
  shutdownInfra()
  rmSync(dataDir, { recursive: true, force: true })
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
})

describe('gitHub cache maintenance', () => {
  it('prunes one bounded stale batch and becomes a no-op', () => {
    const now = 2_000_000
    db().insert(githubApiCache).values([
      { cacheKey: 'stale-1', dataJson: '{"value":1}', fetchedAt: now - 200 },
      { cacheKey: 'stale-2', dataJson: '{"value":2}', fetchedAt: now - 150 },
      { cacheKey: 'fresh', dataJson: '{"value":3}', fetchedAt: now - 10 },
    ]).run()

    expect(pruneStaleCache(100, 1, now)).toBe(1)
    expect(db().select().from(githubApiCache).all()).toHaveLength(2)
    expect(pruneStaleCache(100, 10, now)).toBe(1)
    expect(pruneStaleCache(100, 10, now)).toBe(0)
    expect(db().select().from(githubApiCache).all()).toEqual([
      expect.objectContaining({ cacheKey: 'fresh' }),
    ])
  })
})

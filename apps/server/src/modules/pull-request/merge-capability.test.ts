import { describe, expect, it } from 'vitest'

import { derivePullRequestMergeCapability } from './merge-capability'

const base = {
  state: 'open' as const,
  merged: false,
  isDraft: false,
  mergeable: true as boolean | null,
  mergeableState: 'clean',
  checksState: 'success' as const,
  allowMergeCommit: true,
  allowSquashMerge: true,
  allowRebaseMerge: false,
}

describe('derivePullRequestMergeCapability', () => {
  it('allows merge when the PR is clean and checks pass', () => {
    expect(derivePullRequestMergeCapability(base)).toEqual({
      allowedMergeMethods: ['merge', 'squash'],
      mergeBlockers: [],
      canMerge: true,
    })
  })

  it('hard-disables draft, blocked, dirty, unstable, and pending checks', () => {
    expect(derivePullRequestMergeCapability({
      ...base,
      isDraft: true,
      mergeableState: 'blocked',
      checksState: 'pending',
    }).mergeBlockers).toEqual(expect.arrayContaining([
      'draft',
      'blocked',
      'checks_pending',
    ]))

    expect(derivePullRequestMergeCapability({
      ...base,
      mergeable: false,
      mergeableState: 'dirty',
    }).canMerge).toBe(false)

    expect(derivePullRequestMergeCapability({
      ...base,
      mergeableState: 'unstable',
    }).canMerge).toBe(false)
  })
})

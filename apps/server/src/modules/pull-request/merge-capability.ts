export type PullRequestMergeMethod = 'merge' | 'squash' | 'rebase'

export type PullRequestMergeBlockerCode
  = | 'not_open'
    | 'merged'
    | 'draft'
    | 'conflicts'
    | 'blocked'
    | 'unstable'
    | 'mergeability_unknown'
    | 'checks_pending'
    | 'checks_failure'
    | 'no_merge_methods'

export interface PullRequestMergeCapabilityInput {
  state: 'open' | 'closed'
  merged: boolean
  isDraft: boolean
  mergeable: boolean | null
  mergeableState: string
  checksState: 'success' | 'failure' | 'pending' | 'neutral'
  allowMergeCommit: boolean
  allowSquashMerge: boolean
  allowRebaseMerge: boolean
}

export interface PullRequestMergeCapability {
  allowedMergeMethods: PullRequestMergeMethod[]
  mergeBlockers: PullRequestMergeBlockerCode[]
  canMerge: boolean
}

const HARD_MERGEABLE_STATES = new Set(['dirty', 'blocked', 'unstable'])

export function derivePullRequestMergeCapability(
  input: PullRequestMergeCapabilityInput,
): PullRequestMergeCapability {
  const allowedMergeMethods: PullRequestMergeMethod[] = []
  if (input.allowMergeCommit) {
    allowedMergeMethods.push('merge')
  }
  if (input.allowSquashMerge) {
    allowedMergeMethods.push('squash')
  }
  if (input.allowRebaseMerge) {
    allowedMergeMethods.push('rebase')
  }

  const mergeBlockers: PullRequestMergeBlockerCode[] = []
  if (input.merged) {
    mergeBlockers.push('merged')
  }
  else if (input.state !== 'open') {
    mergeBlockers.push('not_open')
  }
  if (input.isDraft) {
    mergeBlockers.push('draft')
  }
  if (input.mergeable === false || input.mergeableState === 'dirty') {
    mergeBlockers.push('conflicts')
  }
  else if (input.mergeable === null) {
    mergeBlockers.push('mergeability_unknown')
  }
  if (input.mergeableState === 'blocked') {
    mergeBlockers.push('blocked')
  }
  if (input.mergeableState === 'unstable') {
    mergeBlockers.push('unstable')
  }
  if (input.checksState === 'pending') {
    mergeBlockers.push('checks_pending')
  }
  if (input.checksState === 'failure') {
    mergeBlockers.push('checks_failure')
  }
  if (allowedMergeMethods.length === 0) {
    mergeBlockers.push('no_merge_methods')
  }

  const canMerge = mergeBlockers.length === 0
    && input.mergeable === true
    && !HARD_MERGEABLE_STATES.has(input.mergeableState)

  return { allowedMergeMethods, mergeBlockers, canMerge }
}

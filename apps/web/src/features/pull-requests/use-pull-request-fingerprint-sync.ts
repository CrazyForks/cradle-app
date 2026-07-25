import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import { getPullRequestsByOwnerByRepoByNumberDetailQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import {
  getPullRequestsByOwnerByRepoByNumberFingerprint,
  postPullRequestsByOwnerByRepoByNumberFingerprintProbe,
} from '~/api-gen/sdk.gen'
import type { PostPullRequestsByOwnerByRepoByNumberFingerprintProbeResponse } from '~/api-gen/types.gen'

const PROBE_INTERVAL_MS = 20_000

type PullRequestFingerprint = PostPullRequestsByOwnerByRepoByNumberFingerprintProbeResponse['fingerprint']

interface UsePullRequestFingerprintSyncOptions {
  owner: string
  repo: string
  number: number
  enabled?: boolean
}

export function usePullRequestFingerprintSync({
  owner,
  repo,
  number,
  enabled = true,
}: UsePullRequestFingerprintSyncOptions) {
  const queryClient = useQueryClient()
  const path = { owner, repo, number: String(number) }
  const fingerprintRef = useRef<PullRequestFingerprint | null>(null)
  const inFlightRef = useRef(false)
  const visibleRef = useRef(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  )

  const invalidateDetail = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: getPullRequestsByOwnerByRepoByNumberDetailQueryKey({ path }),
    })
  }, [queryClient, owner, repo, number])

  const applyProbeResult = useCallback((result: PostPullRequestsByOwnerByRepoByNumberFingerprintProbeResponse) => {
    fingerprintRef.current = result.fingerprint
    if (result.changed) {
      invalidateDetail()
    }
  }, [invalidateDetail])

  const probe = useCallback(async () => {
    if (!enabled || inFlightRef.current) {
      return
    }
    inFlightRef.current = true
    try {
      const { data, error } = await postPullRequestsByOwnerByRepoByNumberFingerprintProbe({
        path,
        body: { previous: fingerprintRef.current },
      })
      if (error || !data) {
        return
      }
      applyProbeResult(data)
    }
    finally {
      inFlightRef.current = false
    }
  }, [applyProbeResult, enabled, owner, repo, number])

  const resetFingerprint = useCallback(async () => {
    fingerprintRef.current = null
    if (!enabled) {
      return
    }
    const { data, error } = await getPullRequestsByOwnerByRepoByNumberFingerprint({ path })
    if (!error && data) {
      fingerprintRef.current = data.fingerprint
    }
  }, [enabled, owner, repo, number])

  useEffect(() => {
    if (!enabled) {
      return
    }

    void (async () => {
      const { data, error } = await getPullRequestsByOwnerByRepoByNumberFingerprint({ path })
      if (!error && data) {
        fingerprintRef.current = data.fingerprint
      }
    })()

    function handleVisibilityChange() {
      visibleRef.current = document.visibilityState === 'visible'
      if (visibleRef.current) {
        void probe()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    const intervalId = window.setInterval(() => {
      if (visibleRef.current) {
        void probe()
      }
    }, PROBE_INTERVAL_MS)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [enabled, probe, owner, repo, number])

  return { resetFingerprint }
}

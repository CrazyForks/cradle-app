import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppPreferences } from './use-app-preferences'
import {
  APP_PREFS_QUERY_KEY,
  useUpdateAppPreferencesMutation,
} from './use-app-preferences'

const mocks = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock('./api/preferences', () => ({
  preferencesGateway: {
    app: {
      queryKey: ['preferences', 'app'],
      queryOptions: () => ({ queryKey: ['preferences', 'app'], queryFn: vi.fn() }),
      update: mocks.update,
    },
  },
}))

const initialPreferences: AppPreferences = {
  featureFlags: {
    multiWorkspacePoc: false,
    localAuthForDangerousActions: false,
    continueBlockedCodexGoals: false,
    blockCodexAppServerLogInserts: false,
    codexCliCompatibleIdentity: false,
    nativeProviderSkillProjection: false,
    turnCheckpoints: false,
    threadHandoffs: false,
  },
  worktreeCleanup: { maxWorktrees: 25, maxTotalSizeGb: 50 },
}

describe('app preference mutations', () => {
  beforeEach(() => mocks.update.mockReset())

  it('keeps experimental features disabled in the initial preference fixture', () => {
    expect(initialPreferences.featureFlags.turnCheckpoints).toBe(false)
    expect(initialPreferences.featureFlags.threadHandoffs).toBe(false)
  })

  it('serializes concurrent writers so unrelated fields are not lost', async () => {
    let resolveFirst!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    mocks.update
      .mockImplementationOnce(async () => await firstWrite)
      .mockResolvedValueOnce(undefined)

    const queryClient = new QueryClient()
    queryClient.setQueryData(APP_PREFS_QUERY_KEY, initialPreferences)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const first = renderHook(() => useUpdateAppPreferencesMutation(), { wrapper })
    const second = renderHook(() => useUpdateAppPreferencesMutation(), { wrapper })

    let firstPromise!: Promise<AppPreferences | null>
    let secondPromise!: Promise<AppPreferences | null>
    act(() => {
      firstPromise = first.result.current.mutateAsync({
        featureFlags: { ...initialPreferences.featureFlags, multiWorkspacePoc: true },
      })
      secondPromise = second.result.current.mutateAsync({
        worktreeCleanup: { maxWorktrees: 10, maxTotalSizeGb: 20 },
      })
    })

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
    resolveFirst()
    await firstPromise
    await secondPromise

    expect(mocks.update).toHaveBeenNthCalledWith(2, {
      featureFlags: { ...initialPreferences.featureFlags, multiWorkspacePoc: true },
      worktreeCleanup: { maxWorktrees: 10, maxTotalSizeGb: 20 },
    })
    expect(queryClient.getQueryData(APP_PREFS_QUERY_KEY)).toEqual({
      featureFlags: { ...initialPreferences.featureFlags, multiWorkspacePoc: true },
      worktreeCleanup: { maxWorktrees: 10, maxTotalSizeGb: 20 },
    })
  })
})

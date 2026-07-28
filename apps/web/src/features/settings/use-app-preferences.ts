// App preferences query and mutation helpers for Cradle-owned feature flags.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { preferencesGateway } from './api/preferences'

export interface AppPreferences {
  featureFlags: {
    multiWorkspacePoc: boolean
    localAuthForDangerousActions: boolean
    continueBlockedCodexGoals: boolean
    blockCodexAppServerLogInserts: boolean
    codexCliCompatibleIdentity: boolean
    nativeProviderSkillProjection: boolean
    turnCheckpoints: boolean
    threadHandoffs: boolean
  }
  worktreeCleanup: {
    maxWorktrees: number
    maxTotalSizeGb: number
  }
}

export type AppFeatureFlagKey = keyof AppPreferences['featureFlags']

const AppPreferencesSchema = z.object({
  featureFlags: z.object({
    multiWorkspacePoc: z.boolean().default(false),
    localAuthForDangerousActions: z.boolean().default(false),
    continueBlockedCodexGoals: z.boolean().default(false),
    blockCodexAppServerLogInserts: z.boolean().default(false),
    codexCliCompatibleIdentity: z.boolean().default(false),
    nativeProviderSkillProjection: z.boolean().default(false),
    turnCheckpoints: z.boolean().default(false),
    threadHandoffs: z.boolean().default(false),
  }).default({
    multiWorkspacePoc: false,
    localAuthForDangerousActions: false,
    continueBlockedCodexGoals: false,
    blockCodexAppServerLogInserts: false,
    codexCliCompatibleIdentity: false,
    nativeProviderSkillProjection: false,
    turnCheckpoints: false,
    threadHandoffs: false,
  }),
  worktreeCleanup: z.object({
    maxWorktrees: z.number().min(0).default(25),
    maxTotalSizeGb: z.number().min(0).default(50),
  }).default({
    maxWorktrees: 25,
    maxTotalSizeGb: 50,
  }),
})

export const APP_PREFS_QUERY_KEY = preferencesGateway.app.queryKey

export function useAppPreferencesQuery() {
  return useQuery({
    ...preferencesGateway.app.queryOptions(),
    select: data => AppPreferencesSchema.parse(data) satisfies AppPreferences,
  })
}

export function useUpdateAppPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<AppPreferences | null, Error, Partial<AppPreferences>>({
    scope: { id: 'app-preferences' },
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<AppPreferences>(APP_PREFS_QUERY_KEY)
      if (!current) {
        return null
      }

      const next = {
        ...current,
        ...updates,
        featureFlags: {
          ...current.featureFlags,
          ...updates.featureFlags,
        },
        worktreeCleanup: {
          ...current.worktreeCleanup,
          ...updates.worktreeCleanup,
        },
      }
      await preferencesGateway.app.update(next)

      return next
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(APP_PREFS_QUERY_KEY, updated)
      }
    },
  })
}

export function useAppPreferences() {
  const { data: prefs, isLoading, isSuccess } = useAppPreferencesQuery()
  const { mutateAsync: savePrefs, isPending: isSaving } = useUpdateAppPreferencesMutation()

  return { prefs: prefs ?? null, isLoading, isSuccess, savePrefs, isSaving }
}

export function isAppFeatureFlagEnabled(
  prefs: AppPreferences | null | undefined,
  key: AppFeatureFlagKey,
): boolean {
  return prefs?.featureFlags[key] === true
}

export function useFeatureFlag(key: AppFeatureFlagKey): boolean {
  const { data: prefs } = useAppPreferencesQuery()

  return isAppFeatureFlagEnabled(prefs, key)
}

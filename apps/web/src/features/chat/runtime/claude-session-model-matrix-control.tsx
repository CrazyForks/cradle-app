import { Settings2Line as SettingsIcon } from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { MenuSub, MenuSubPopup, MenuSubTrigger } from '~/components/ui/menu'
import { toastManager } from '~/components/ui/toast'
import { ClaudeModelMatrixEditor } from '~/features/agent-management/claude-model-matrix-editor'
import {
  claudeAgentAliasesFromConfig,
  loadProviderTargetModelSettings,
  updateProviderTargetClaudeAgentAliases,
} from '~/features/agent-management/provider-target-model-settings'
import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import {
  DEFAULT_CLAUDE_AGENT_ALIASES,
  hasClaudeAgentModelAliases,
} from '~/features/agent-runtime/claude-agent-config'
import { supportsClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-model-aliases'
import type { ApiProviderKind, ModelDescriptor } from '~/features/agent-runtime/types'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'

function providerTargetModelSettingsQueryKey(providerTargetId: string | null) {
  return ['provider-target-model-settings', providerTargetId ?? 'no-provider-target'] as const
}

/**
 * Shape consumed by the composer alias menu. Models + mainModelId are sourced
 * from the picker context itself, so the slot only carries alias state.
 */
export interface ClaudeAgentModelAliasesSlot {
  aliases: ClaudeAgentModelAliases
  onChange: (next: ClaudeAgentModelAliases) => void
  loading?: boolean
}

/**
 * Model aliases are a provider property: only the provider target's
 * `claudeAgent.modelAliases` reaches the Claude Agent SDK environment. This
 * slot reads and writes that single source of truth, so edits made from the
 * composer apply to every chat using the provider.
 */
export function useProviderClaudeAgentModelAliases(args: {
  active: boolean
  enabled: boolean
  providerTargetId: string | null
  providerKind: ApiProviderKind | null
}): ClaudeAgentModelAliasesSlot | null {
  const { active, enabled: enabledInput, providerTargetId, providerKind } = args
  const enabled = active
    && enabledInput
    && !!providerTargetId
    && supportsClaudeAgentModelAliases(providerKind)
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({
    queryKey: providerTargetModelSettingsQueryKey(providerTargetId),
    queryFn: () => loadProviderTargetModelSettings({ id: providerTargetId! }),
    enabled,
    staleTime: 10_000,
    retry: false,
  })

  const mutation = useMutation({
    mutationFn: (next: ClaudeAgentModelAliases) =>
      updateProviderTargetClaudeAgentAliases({ id: providerTargetId! }, next),
    onSuccess: (data) => {
      queryClient.setQueryData(providerTargetModelSettingsQueryKey(providerTargetId), data)
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: 'error',
        title: 'Save Claude aliases failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      void queryClient.invalidateQueries({
        queryKey: providerTargetModelSettingsQueryKey(providerTargetId),
      })
    },
  })
  const { mutate, isPending, variables } = mutation

  return useMemo<ClaudeAgentModelAliasesSlot | null>(() => {
    if (!enabled) {
      return null
    }
    const savedAliases = settingsQuery.data
      ? claudeAgentAliasesFromConfig(settingsQuery.data.connectionConfigJson)
      : DEFAULT_CLAUDE_AGENT_ALIASES
    return {
      // While a write is in flight, show the requested matrix so the menu
      // feels instant instead of snapping back to the stale server copy.
      aliases: isPending && variables ? variables : savedAliases,
      loading: settingsQuery.isLoading,
      onChange: next => mutate(next),
    }
  }, [enabled, settingsQuery.data, settingsQuery.isLoading, isPending, variables, mutate])
}

export function ClaudeAgentModelAliasesSubmenu({
  models,
  selectedModelId,
  aliases,
  loading,
  onChange,
  loadingModels,
  occludeNativeBrowserSurface,
}: {
  models: ModelDescriptor[]
  selectedModelId: string | null
  aliases: ClaudeAgentModelAliases
  loading?: boolean
  loadingModels?: boolean
  onChange: (next: ClaudeAgentModelAliases) => void
  occludeNativeBrowserSurface?: boolean
}) {
  const isCustom = hasClaudeAgentModelAliases(aliases)
  const selectedModel = models.find(m => m.id === selectedModelId) ?? null
  const mainModelLabel = selectedModel?.label
    ?? selectedModelId
    ?? (loadingModels ? 'Loading...' : 'default')

  return (
    <MenuSub>
      <MenuSubTrigger
        data-testid="claude-agent-model-aliases-trigger"
        data-selected-model-id={selectedModelId ?? ''}
        className={cn(isCustom && 'text-primary font-medium')}
      >
        <SettingsIcon className="size-3.5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">Model aliases</span>
          <span className="max-w-52 truncate text-[11px] font-normal text-muted-foreground/60">
            Main model:
            {' '}
            {mainModelLabel}
          </span>
        </div>
        {isCustom && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
      </MenuSubTrigger>
      <MenuSubPopup
        {...(occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {})}
        className="w-[24rem] p-0"
      >
        <div className="min-w-0 p-2">
          <ClaudeModelMatrixEditor
            aliases={aliases}
            models={models}
            mainModelId={selectedModelId}
            loading={loading || loadingModels}
            onChange={onChange}
          />
        </div>
      </MenuSubPopup>
    </MenuSub>
  )
}

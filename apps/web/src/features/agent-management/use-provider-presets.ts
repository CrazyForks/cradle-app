import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getProviderPresetsOptions } from '~/api-gen/@tanstack/react-query.gen'
import type { GetProviderPresetsResponse } from '~/api-gen/types.gen'

import type { ProviderPreset } from './provider-templates'
import { PROVIDER_PRESETS } from './provider-templates'

type ServerProviderPreset = GetProviderPresetsResponse[number]

function toUiPreset(preset: ServerProviderPreset): ProviderPreset {
  const fields: ProviderPreset['fields'] = [
    { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: preset.baseUrl, mono: true },
  ]
  if (preset.requiresApiKey) {
    fields.push({ key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', mono: true })
  }
  return {
    id: preset.id,
    name: preset.name,
    tagline: preset.local ? 'Runs on your machine' : preset.baseUrl,
    description: preset.models.length > 0 ? `${preset.models.length} known models` : undefined,
    providerKind: preset.providerKind,
    accent: '',
    fields,
    defaults: { baseUrl: preset.baseUrl },
    iconSlug: preset.iconSlug,
    models: preset.models,
  }
}

/**
 * Merges the server-side provider catalog (`GET /provider-presets`) with the
 * three local wizard presets. Local presets keep their richer taglines and
 * auth flows; server presets fill in everything else and contribute known
 * model lists. Falls back to the local presets while loading or on error.
 */
export function useMergedProviderPresets(): { presets: ProviderPreset[], isLoading: boolean } {
  const query = useQuery(getProviderPresetsOptions())

  const presets = useMemo(() => {
    const serverPresets = query.data ?? []
    const localIds = new Set(PROVIDER_PRESETS.map(p => p.id))
    const merged = PROVIDER_PRESETS.map((local) => {
      const remote = serverPresets.find(p => p.id === local.id)
      return remote ? { ...local, models: remote.models } : local
    })
    const rest = serverPresets
      .filter(p => !localIds.has(p.id))
      .sort((a, b) => {
        if ((a.source === 'overlay') !== (b.source === 'overlay')) {
          return a.source === 'overlay' ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
      .map(toUiPreset)
    return [...merged, ...rest]
  }, [query.data])

  return { presets, isLoading: query.isLoading }
}

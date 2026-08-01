/**
 * Provider Preset Catalog
 *
 * Merges the public models.dev registry (provider-level `api` and `doc`
 * plus per-model metadata) with the curated local overlay. The overlay wins on
 * conflicts and supplies vendors models.dev does not cover; models.dev
 * providers without an `api` base URL are dropped unless an overlay entry
 * claims them.
 */

import type { ModelsDevModel, ModelsDevProvider } from '../model-registry/model-info-registry'
import { fetchModelsDevData } from '../model-registry/model-info-registry'
import type { ProviderKind } from '../provider-contracts/types'
import type { ProviderPresetOverlayEntry } from './provider-preset-overlay'
import { PROVIDER_PRESET_OVERLAY } from './provider-preset-overlay'

export interface ProviderPresetModel {
  id: string
  name?: string
  reasoning?: boolean
  toolCall?: boolean
  vision?: boolean
}

export interface ProviderPreset {
  id: string
  name: string
  providerKind: ProviderKind
  baseUrl: string
  iconSlug?: string
  docsUrl?: string
  local: boolean
  requiresApiKey: boolean
  source: 'models.dev' | 'overlay'
  models: ProviderPresetModel[]
}

function projectModel(id: string, model: ModelsDevModel | undefined): ProviderPresetModel {
  if (!model) {
    return { id }
  }
  return {
    id,
    ...(model.name ? { name: model.name } : {}),
    ...(model.reasoning === true ? { reasoning: true } : {}),
    ...(model.tool_call === true ? { toolCall: true } : {}),
    ...(model.modalities?.input?.includes('image') ? { vision: true } : {}),
  }
}

function hostMatches(hostname: string, candidates: string[]): boolean {
  return candidates.some(candidate => hostname === candidate || hostname.endsWith(`.${candidate}`))
}

function apiHostname(provider: ModelsDevProvider): string | null {
  if (typeof provider.api !== 'string' || provider.api.length === 0) {
    return null
  }
  try {
    return new URL(provider.api).hostname.toLowerCase()
  }
  catch {
    return null
  }
}

/**
 * Match an overlay entry to a models.dev provider by id first, then by the
 * hostname of the provider's `api` URL. A models.dev provider without `api`
 * (e.g. groq) can only be claimed by id.
 */
function findModelsDevProvider(
  data: Record<string, ModelsDevProvider> | null,
  overlay: ProviderPresetOverlayEntry,
): [string, ModelsDevProvider] | null {
  if (!data) {
    return null
  }
  const byId = data[overlay.id]
  if (byId) {
    return [overlay.id, byId]
  }
  for (const [id, provider] of Object.entries(data)) {
    const hostname = apiHostname(provider)
    if (hostname && hostMatches(hostname, overlay.hostnames)) {
      return [id, provider]
    }
  }
  return null
}

function buildOverlayPreset(
  overlay: ProviderPresetOverlayEntry,
  provider: ModelsDevProvider | undefined,
): ProviderPreset {
  const registryModels = provider?.models ?? {}
  const models = overlay.defaultModels
    ? overlay.defaultModels.map(id => projectModel(id, registryModels[id]))
    : Object.keys(registryModels).map(id => projectModel(id, registryModels[id]))
  const docsUrl = overlay.docsUrl ?? provider?.doc
  return {
    id: overlay.id,
    name: overlay.name,
    providerKind: overlay.providerKind,
    baseUrl: overlay.baseUrl,
    ...(overlay.iconSlug ? { iconSlug: overlay.iconSlug } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    local: overlay.local ?? false,
    requiresApiKey: overlay.requiresApiKey ?? true,
    source: 'overlay',
    models,
  }
}

function buildModelsDevPreset(id: string, provider: ModelsDevProvider): ProviderPreset {
  return {
    id,
    name: provider.name ?? id,
    // models.dev providers with an `api` URL are OpenAI-compatible unless they ship the Anthropic SDK.
    providerKind: provider.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai-compatible',
    baseUrl: provider.api ?? '',
    ...(provider.doc ? { docsUrl: provider.doc } : {}),
    local: false,
    requiresApiKey: true,
    source: 'models.dev',
    models: Object.entries(provider.models).map(([modelId, model]) => projectModel(modelId, model)),
  }
}

export async function collectProviderPresets(): Promise<ProviderPreset[]> {
  const data = await fetchModelsDevData()
  const presets: ProviderPreset[] = []
  const consumedProviderIds = new Set<string>()

  for (const overlay of PROVIDER_PRESET_OVERLAY) {
    const match = findModelsDevProvider(data, overlay)
    if (match) {
      consumedProviderIds.add(match[0])
    }
    presets.push(buildOverlayPreset(overlay, match?.[1]))
  }

  if (data) {
    const remaining = Object.entries(data)
      .filter(([id, provider]) => !consumedProviderIds.has(id) && apiHostname(provider) !== null)
      .sort((a, b) => (a[1].name ?? a[0]).localeCompare(b[1].name ?? b[0]))
    for (const [id, provider] of remaining) {
      presets.push(buildModelsDevPreset(id, provider))
    }
  }

  return presets
}

import type { PatchProfilesByIdCustomModelsData } from '~/api-gen/types.gen'
import type { ApiProviderKind } from '~/features/agent-runtime/types'

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
  tagline: string
  providerKind: ApiProviderKind
  accent: string
  fields: PresetField[]
  defaults: Record<string, unknown>
  /** Secondary paragraph on the preset card; falls back to tagline. */
  description?: string
  /** Server-provided icon hint; falls back to the preset id. */
  iconSlug?: string
  /** Known models from the server catalog, used to pre-fill custom models. */
  models?: ProviderPresetModel[]
}

interface PresetField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder?: string
  mono?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    tagline: 'Official Claude API or Anthropic message API',
    providerKind: 'anthropic',
    accent: 'orange',
    fields: [
      { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: 'https://api.anthropic.com/v1', mono: true },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...', mono: true },
    ],
    defaults: { baseUrl: 'https://api.anthropic.com/v1' },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'OpenAI Responses API or Official Codex account',
    providerKind: 'openai-compatible',
    accent: 'emerald',
    fields: [
      { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: 'https://api.openai.com/v1', mono: true },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', mono: true },
    ],
    defaults: { baseUrl: 'https://api.openai.com/v1' },
  },
  {
    id: 'universal',
    name: 'Universal',
    tagline: 'Custom endpoint with OpenAI and Anthropic supported',
    providerKind: 'universal',
    accent: 'violet',
    fields: [
      { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: 'https://api.example.com/v1', mono: true },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', mono: true },
    ],
    defaults: { baseUrl: '' },
  },
]

type CustomModelEntry = PatchProfilesByIdCustomModelsData['body']['models'][number]

/** Maps catalog preset models to the custom-models PATCH payload shape. */
export function presetModelsToCustomModels(models: ProviderPresetModel[]): CustomModelEntry[] {
  return models.map(model => ({
    id: model.id,
    label: model.name ?? model.id,
    capabilities: {
      ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
      ...(model.toolCall !== undefined ? { toolCall: model.toolCall } : {}),
      ...(model.vision ? { inputModalities: ['text', 'image'] } : {}),
    },
  }))
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  }
  catch {
    return null
  }
}

/** Finds the catalog preset whose base URL hostname matches the given endpoint. */
export function matchCatalogPresetByEndpoint(
  presets: ProviderPreset[],
  endpoint: string,
): ProviderPreset | null {
  const host = hostnameOf(endpoint.trim())
  if (!host) {
    return null
  }
  return presets.find((preset) => {
    const baseUrl = preset.defaults.baseUrl
    return typeof baseUrl === 'string' && baseUrl.length > 0 && hostnameOf(baseUrl) === host
  }) ?? null
}

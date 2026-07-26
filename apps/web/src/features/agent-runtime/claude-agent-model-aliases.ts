import type { ClaudeAgentAliasKey, ClaudeAgentModelAliases } from './claude-agent-config'
import { CLAUDE_AGENT_ALIAS_KEYS, DEFAULT_CLAUDE_AGENT_ALIASES } from './claude-agent-config'
import type { ApiProviderKind } from './types'

export function supportsClaudeAgentModelAliases(providerKind: ApiProviderKind | null): boolean {
  return providerKind === 'anthropic' || providerKind === 'universal'
}

export interface AliasModelCandidate {
  id: string
  label?: string | null
}

const TIER_KEYWORDS: Record<ClaudeAgentAliasKey, string[]> = {
  haiku: ['haiku'],
  sonnet: ['sonnet'],
  opus: ['opus', 'fable', 'mythos'],
}

function matchScore(model: AliasModelCandidate, keywords: string[]): number {
  const id = model.id.toLowerCase()
  const label = (model.label ?? '').toLowerCase()
  for (const [index, keyword] of keywords.entries()) {
    // Earlier keywords are stronger signals; id matches beat label-only matches.
    const weight = (keywords.length - index) * 2
    if (id.includes(keyword)) {
      return weight
    }
    if (label.includes(keyword)) {
      return weight - 1
    }
  }
  return 0
}

/**
 * Models matching a tier's naming, best first. Ranking prefers id matches over
 * label-only matches, then newer-looking ids (numeric-aware descending), so
 * "claude-haiku-4-5" outranks "claude-3-5-haiku-20241022".
 */
export function rankClaudeAgentTierCandidates(
  models: AliasModelCandidate[],
  tier: ClaudeAgentAliasKey,
): AliasModelCandidate[] {
  const keywords = TIER_KEYWORDS[tier]
  return models
    .map(model => ({ model, score: matchScore(model, keywords) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) =>
      b.score - a.score
      || b.model.id.localeCompare(a.model.id, undefined, { numeric: true, sensitivity: 'base' }))
    .map(entry => entry.model)
}

/**
 * Best-effort alias matrix inferred from the provider's model list. Tiers with
 * no name match stay empty (inherit the main model).
 */
export function suggestClaudeAgentModelAliases(
  models: AliasModelCandidate[],
): ClaudeAgentModelAliases {
  const next = { ...DEFAULT_CLAUDE_AGENT_ALIASES }
  for (const tier of CLAUDE_AGENT_ALIAS_KEYS) {
    next[tier] = rankClaudeAgentTierCandidates(models, tier)[0]?.id ?? ''
  }
  return next
}

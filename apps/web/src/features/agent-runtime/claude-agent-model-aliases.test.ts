import { describe, expect, it } from 'vitest'

import {
  rankClaudeAgentTierCandidates,
  suggestClaudeAgentModelAliases,
} from './claude-agent-model-aliases'

describe('rankClaudeAgentTierCandidates', () => {
  it('matches tier keywords in model ids case-insensitively', () => {
    const ranked = rankClaudeAgentTierCandidates(
      [
        { id: 'gpt-4o' },
        { id: 'Claude-3-5-HAIKU-20241022' },
        { id: 'claude-sonnet-4-5' },
      ],
      'haiku',
    )
    expect(ranked.map(model => model.id)).toEqual(['Claude-3-5-HAIKU-20241022'])
  })

  it('prefers id matches over label-only matches', () => {
    const ranked = rankClaudeAgentTierCandidates(
      [
        { id: 'hi-code-net-small', label: 'Hi-Code Net Haiku' },
        { id: 'claude-haiku-4-5', label: 'Fast model' },
      ],
      'haiku',
    )
    expect(ranked.map(model => model.id)).toEqual(['claude-haiku-4-5', 'hi-code-net-small'])
  })

  it('ranks newer-looking ids first within the same match strength', () => {
    const ranked = rankClaudeAgentTierCandidates(
      [
        { id: 'claude-3-5-haiku-20241022' },
        { id: 'claude-haiku-4-5' },
      ],
      'haiku',
    )
    expect(ranked[0]?.id).toBe('claude-haiku-4-5')
  })

  it('prefers opus matches over fable/mythos fallbacks for the opus tier', () => {
    const ranked = rankClaudeAgentTierCandidates(
      [
        { id: 'claude-fable-5' },
        { id: 'claude-opus-4-8' },
      ],
      'opus',
    )
    expect(ranked.map(model => model.id)).toEqual(['claude-opus-4-8', 'claude-fable-5'])
  })

  it('falls back to fable/mythos models when no opus model exists', () => {
    const ranked = rankClaudeAgentTierCandidates(
      [
        { id: 'claude-fable-5' },
        { id: 'claude-haiku-4-5' },
      ],
      'opus',
    )
    expect(ranked.map(model => model.id)).toEqual(['claude-fable-5'])
  })
})

describe('suggestClaudeAgentModelAliases', () => {
  it('fills each tier with its best match and leaves misses empty', () => {
    const suggestion = suggestClaudeAgentModelAliases([
      { id: 'claude-haiku-4-5' },
      { id: 'claude-sonnet-5' },
      { id: 'gpt-4o' },
    ])
    expect(suggestion).toEqual({
      haiku: 'claude-haiku-4-5',
      sonnet: 'claude-sonnet-5',
      opus: '',
    })
  })

  it('returns all-empty aliases when nothing matches', () => {
    expect(suggestClaudeAgentModelAliases([{ id: 'gpt-4o' }, { id: 'gemini-2.5-pro' }])).toEqual({
      haiku: '',
      sonnet: '',
      opus: '',
    })
  })
})

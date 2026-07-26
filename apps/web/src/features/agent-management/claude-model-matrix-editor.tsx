import {
  ArrowRightUpLine as InheritIcon,
  CheckLine as CheckIcon,
  DownSmallLine as ChevronDownIcon,
  SparklesLine as SparklesIcon,
} from '@mingcute/react'
import { useMemo, useState } from 'react'

import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import type { ClaudeAgentAliasKey, ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import {
  CLAUDE_AGENT_ALIAS_KEYS,
  DEFAULT_CLAUDE_AGENT_ALIASES,
  hasClaudeAgentModelAliases,
} from '~/features/agent-runtime/claude-agent-config'
import {
  rankClaudeAgentTierCandidates,
  suggestClaudeAgentModelAliases,
} from '~/features/agent-runtime/claude-agent-model-aliases'
import type { ModelDescriptor } from '~/features/agent-runtime/types'
import { cn } from '~/lib/cn'

import { SettingsDivider } from '../settings/settings-row'

const SUGGESTED_OPTION_COUNT = 3

const TIERS: Array<{ key: ClaudeAgentAliasKey, label: string, role: string }> = [
  { key: 'haiku', label: 'Haiku', role: 'Fast' },
  { key: 'sonnet', label: 'Sonnet', role: 'Balanced' },
  { key: 'opus', label: 'Opus', role: 'Most capable' },
]

interface ModelOption {
  id: string
  label: string
}

function modelLabel(model: ModelDescriptor): string {
  return model.label || model.id
}

function dedupeModelOptions(input: ModelOption[]): ModelOption[] {
  const seen = new Set<string>()
  return input.filter((model) => {
    if (seen.has(model.id)) {
      return false
    }
    seen.add(model.id)
    return true
  })
}

function buildModelOptions(input: {
  models: ModelDescriptor[]
  aliases: ClaudeAgentModelAliases
  mainModelId: string | null
}): ModelOption[] {
  const aliasModels = CLAUDE_AGENT_ALIAS_KEYS
    .map(key => input.aliases[key].trim())
    .filter(Boolean)
    .map(id => ({ id, label: id }))

  const mainModel = input.mainModelId
    ? [{ id: input.mainModelId, label: input.mainModelId }]
    : []

  return dedupeModelOptions([
    ...mainModel,
    ...input.models.map(model => ({ id: model.id, label: modelLabel(model) })),
    ...aliasModels,
  ])
}

export function ClaudeModelMatrixEditor({
  aliases,
  models,
  mainModelId,
  loading = false,
  onChange,
}: {
  aliases: ClaudeAgentModelAliases
  models: ModelDescriptor[]
  mainModelId: string | null
  loading?: boolean
  onChange: (next: ClaudeAgentModelAliases) => void
}) {
  const [expandedTier, setExpandedTier] = useState<ClaudeAgentAliasKey | null>(null)
  const [search, setSearch] = useState('')

  const modelOptions = useMemo(
    () => buildModelOptions({ models, aliases, mainModelId }),
    [models, aliases, mainModelId],
  )
  const optionLabels = useMemo(
    () => new Map(modelOptions.map(option => [option.id, option.label])),
    [modelOptions],
  )
  const suggestedByTier = useMemo(() => {
    const entries = CLAUDE_AGENT_ALIAS_KEYS.map((tier) => {
      const ranked = rankClaudeAgentTierCandidates(models, tier)
      return [tier, ranked.slice(0, SUGGESTED_OPTION_COUNT).map(model => model.id)] as const
    })
    return new Map(entries)
  }, [models])
  const suggestion = useMemo(() => suggestClaudeAgentModelAliases(models), [models])

  const mainModel = models.find(model => model.id === mainModelId) ?? null
  const mainModelLabel = mainModel ? modelLabel(mainModel) : mainModelId

  const isCustom = hasClaudeAgentModelAliases(aliases)
  const hasSuggestion = hasClaudeAgentModelAliases(suggestion)
  const suggestionApplied = CLAUDE_AGENT_ALIAS_KEYS.every(
    key => !suggestion[key] || aliases[key].trim() === suggestion[key],
  )
  const suggestionSummary = CLAUDE_AGENT_ALIAS_KEYS
    .filter(key => suggestion[key])
    .map(key => optionLabels.get(suggestion[key]) ?? suggestion[key])
    .join(' · ')

  const applySuggestion = () => {
    onChange(suggestion)
    setExpandedTier(null)
    setSearch('')
  }
  const setAlias = (key: ClaudeAgentAliasKey, value: string) => {
    onChange({ ...aliases, [key]: value })
    setExpandedTier(null)
    setSearch('')
  }
  const toggleExpanded = (key: ClaudeAgentAliasKey) => {
    setExpandedTier(current => (current === key ? null : key))
    setSearch('')
  }

  return (
    <div className="flex min-w-0 flex-col mb-2">
      <div className="overflow-hidden">
        {TIERS.map((tier, index) => {
          const currentValue = aliases[tier.key].trim()
          const isPassthrough = currentValue.length === 0
          const isExpanded = expandedTier === tier.key
          const suggestedIds = suggestedByTier.get(tier.key) ?? []
          const normalizedSearch = search.trim().toLowerCase()
          const isSearching = normalizedSearch.length > 0
          const visibleSuggestedIds = isExpanded && !isSearching ? suggestedIds : []
          const listOptions = isExpanded
            ? modelOptions.filter(option =>
                isSearching
                  ? option.id.toLowerCase().includes(normalizedSearch)
                  || option.label.toLowerCase().includes(normalizedSearch)
                  : !suggestedIds.includes(option.id))
            : []

          return (
            <div key={tier.key} className={cn(isExpanded && 'bg-foreground/[0.025]')}>
              {index > 0 && <SettingsDivider />}
              <button
                type="button"
                data-testid={`claude-agent-model-alias-row-${tier.key}`}
                disabled={modelOptions.length === 0}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleExpanded(tier.key)
                }}
                className={cn(
                  'flex w-full items-center gap-3 px-2.5 py-2 text-left transition-colors',
                  modelOptions.length > 0 && 'hover:bg-foreground/[0.04]',
                )}
              >
                <span className="flex w-[7.5rem] shrink-0 items-baseline gap-1.5">
                  <span className="text-[12px] font-medium text-foreground">{tier.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">
                    {tier.role}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                  {isPassthrough
                    ? (
                        <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
                          <InheritIcon className="size-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                          <span className="truncate">
                            {mainModelLabel ? `Inherits ${mainModelLabel}` : 'Inherits main model'}
                          </span>
                        </span>
                      )
                    : (
                        <span
                          className="min-w-0 truncate text-[12px] font-medium text-primary"
                          title={currentValue}
                        >
                          {optionLabels.get(currentValue) ?? currentValue}
                        </span>
                      )}
                  <ChevronDownIcon
                    className={cn(
                      'size-3.5 shrink-0 text-muted-foreground/50 transition-transform',
                      isExpanded && 'rotate-180',
                    )}
                    aria-hidden="true"
                  />
                </span>
              </button>

              {isExpanded && (
                <div className="flex flex-col gap-1 px-1.5 pb-1.5">
                  <Input
                    aria-label={`Search ${tier.label} model`}
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Search models..."
                    className="h-7 rounded-md border-border/50 bg-input/30 px-2 py-1 text-[12px] placeholder:text-muted-foreground/50 focus-visible:border-border focus-visible:ring-0 md:text-[12px]"
                    onClick={event => event.stopPropagation()}
                    onKeyDown={event => event.stopPropagation()}
                  />
                  <div className="max-h-52 overflow-y-auto">
                    {!isSearching && (
                      <OptionRow
                        active={isPassthrough}
                        label={mainModelLabel ? `Inherit · ${mainModelLabel}` : 'Inherit main model'}
                        onSelect={() => setAlias(tier.key, '')}
                      />
                    )}
                    {visibleSuggestedIds.length > 0 && (
                      <>
                        <SectionLabel>Suggested</SectionLabel>
                        {visibleSuggestedIds.map(id => (
                          <OptionRow
                            key={id}
                            active={id === currentValue}
                            label={optionLabels.get(id) ?? id}
                            detail={optionLabels.get(id) === id ? undefined : id}
                            suggested
                            onSelect={() => setAlias(tier.key, id)}
                          />
                        ))}
                        {listOptions.length > 0 && <SectionLabel>All models</SectionLabel>}
                      </>
                    )}
                    {listOptions.map(option => (
                      <OptionRow
                        key={option.id}
                        active={option.id === currentValue}
                        label={option.label}
                        detail={option.label === option.id ? undefined : option.id}
                        onSelect={() => setAlias(tier.key, option.id)}
                      />
                    ))}
                    {isSearching && listOptions.length === 0 && (
                      <div className="px-2 py-1.5 text-[11px] text-muted-foreground/60">
                        No matching models.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {(loading || isCustom || (hasSuggestion && !suggestionApplied)) && (
          <>
            <SettingsDivider />
            <div className="flex items-center gap-1 px-1.5 py-1">
              {loading && <Spinner className="ml-1 size-3 text-muted-foreground/50" />}
              {hasSuggestion && !suggestionApplied && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-testid="claude-agent-model-aliases-auto-match"
                      onClick={(event) => {
                        event.stopPropagation()
                        applySuggestion()
                      }}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-primary/80 transition-colors hover:bg-primary/8 hover:text-primary"
                    >
                      <SparklesIcon className="size-3" aria-hidden="true" />
                      Auto match
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-72 text-xs">
                    {suggestionSummary}
                  </TooltipContent>
                </Tooltip>
              )}
              {isCustom && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onChange(DEFAULT_CLAUDE_AGENT_ALIASES)
                        setExpandedTier(null)
                        setSearch('')
                      }}
                      className="ml-auto rounded-md px-1.5 py-1 text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
                    >
                      Reset
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Clear alias overrides
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </>
        )}
      </div>

      {modelOptions.length === 0 && (
        <p className="mt-1.5 px-0.5 text-[10.5px] text-muted-foreground/60">
          No models discovered yet — refresh this provider&apos;s model list first.
        </p>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
      {children}
    </div>
  )
}

function OptionRow({
  active,
  label,
  detail,
  suggested = false,
  onSelect,
}: {
  active: boolean
  label: string
  detail?: string
  suggested?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      title={detail ?? label}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-foreground/90 hover:bg-foreground/5',
      )}
    >
      {suggested && (
        <SparklesIcon
          className={cn('size-3 shrink-0', active ? 'text-primary' : 'text-muted-foreground/50')}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && (
        <span className="min-w-0 max-w-44 truncate text-[10.5px] text-muted-foreground/60">
          {detail}
        </span>
      )}
      {active && <CheckIcon className="size-3 shrink-0" aria-hidden="true" />}
    </button>
  )
}

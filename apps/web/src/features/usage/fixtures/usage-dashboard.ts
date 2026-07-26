import type { UsageDashboardViewProps } from '../usage-dashboard-view'
import type {
  CostSummary,
  DailyCost,
  DailyUsage,
  DailyUsageByModel,
  HourlyUsage,
  UsageStats,
  UsageSummary,
} from '../use-usage-overview'

const MODEL_SPLIT = [
  { id: 'gpt-5.2', share: 0.48 },
  { id: 'claude-opus-4.6', share: 0.34 },
  { id: 'gemini-3-pro', share: 0.18 },
] as const

function dateKey(daysAgo: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

const daily: DailyUsage[] = Array.from({ length: 96 }, (_, index) => {
  const daysAgo = 95 - index
  const weekday = new Date(`${dateKey(daysAgo)}T12:00:00`).getDay()
  const active = ![0, 6].includes(weekday) || index % 3 === 0
  const totalTokens = active ? 84_000 + ((index * 37_000) % 410_000) : 0
  return {
    date: dateKey(daysAgo),
    promptTokens: Math.round(totalTokens * 0.76),
    completionTokens: Math.round(totalTokens * 0.24),
    totalTokens,
    count: totalTokens > 0 ? 4 + (index % 19) : 0,
  }
})

const dailyByModel: DailyUsageByModel[] = daily.flatMap((entry, dayIndex) =>
  MODEL_SPLIT.map((model, modelIndex) => ({
    date: entry.date,
    modelId: model.id,
    totalTokens: Math.round(entry.totalTokens * model.share),
    count: entry.count > 0 ? Math.max(1, Math.round(entry.count * model.share) + ((dayIndex + modelIndex) % 2)) : 0,
  })))

const dailyCost: DailyCost[] = dailyByModel.map((entry) => {
  const promptTokens = Math.round(entry.totalTokens * 0.76)
  const completionTokens = entry.totalTokens - promptTokens
  const rate = entry.modelId.startsWith('claude') ? 12 : entry.modelId.startsWith('gpt') ? 8 : 5
  return {
    date: entry.date,
    modelId: entry.modelId,
    costUsd: Number(((entry.totalTokens / 1_000_000) * rate).toFixed(4)),
    promptTokens,
    completionTokens,
    totalTokens: entry.totalTokens,
    stepCount: entry.count,
  }
})

const hourly: HourlyUsage[] = Array.from({ length: 24 }, (_, hour) => {
  const totalTokens = hour >= 9 && hour <= 22
    ? 130_000 + Math.round(Math.sin((hour - 9) / 13 * Math.PI) * 720_000)
    : 18_000 + hour * 2_400
  return {
    hour,
    promptTokens: Math.round(totalTokens * 0.76),
    completionTokens: Math.round(totalTokens * 0.24),
    totalTokens,
    count: Math.max(1, Math.round(totalTokens / 52_000)),
  }
})

const modelTotals = MODEL_SPLIT.map(model => ({
  modelId: model.id,
  totalTokens: dailyByModel
    .filter(entry => entry.modelId === model.id)
    .reduce((sum, entry) => sum + entry.totalTokens, 0),
  count: dailyByModel
    .filter(entry => entry.modelId === model.id)
    .reduce((sum, entry) => sum + entry.count, 0),
}))

const totalTokens = daily.reduce((sum, entry) => sum + entry.totalTokens, 0)
const totalTurns = daily.reduce((sum, entry) => sum + entry.count, 0)

const summary: UsageSummary = {
  totalPromptTokens: Math.round(totalTokens * 0.76),
  totalCompletionTokens: Math.round(totalTokens * 0.24),
  totalTokens,
  totalTurns,
  byModel: modelTotals,
  byAgent: [
    { agentId: 'codex', agentName: 'Codex', totalTokens: Math.round(totalTokens * 0.58), count: Math.round(totalTurns * 0.58) },
    { agentId: 'claude', agentName: 'Claude Agent', totalTokens: Math.round(totalTokens * 0.29), count: Math.round(totalTurns * 0.29) },
    { agentId: 'kimi', agentName: 'Kimi', totalTokens: Math.round(totalTokens * 0.13), count: Math.round(totalTurns * 0.13) },
  ],
  byProviderTarget: [
    { providerTargetId: 'openai', providerTargetName: 'OpenAI', totalTokens: Math.round(totalTokens * 0.48), count: Math.round(totalTurns * 0.48) },
    { providerTargetId: 'anthropic', providerTargetName: 'Anthropic', totalTokens: Math.round(totalTokens * 0.34), count: Math.round(totalTurns * 0.34) },
    { providerTargetId: 'google', providerTargetName: 'Google AI', totalTokens: Math.round(totalTokens * 0.18), count: Math.round(totalTurns * 0.18) },
  ],
}

const costByModel = modelTotals.map((model) => {
  const costUsd = dailyCost
    .filter(entry => entry.modelId === model.modelId)
    .reduce((sum, entry) => sum + entry.costUsd, 0)
  return {
    ...model,
    costUsd,
    promptTokens: Math.round(model.totalTokens * 0.76),
    completionTokens: Math.round(model.totalTokens * 0.24),
  }
})

const totalCostUsd = costByModel.reduce((sum, entry) => sum + entry.costUsd, 0)

const costSummary: CostSummary = {
  totalCostUsd,
  totalPromptTokens: summary.totalPromptTokens,
  totalCompletionTokens: summary.totalCompletionTokens,
  totalTokens,
  byModel: costByModel,
  byAgent: summary.byAgent.map((agent, index) => ({
    ...agent,
    costUsd: totalCostUsd * [0.58, 0.29, 0.13][index],
    promptTokens: Math.round(agent.totalTokens * 0.76),
    completionTokens: Math.round(agent.totalTokens * 0.24),
  })),
  byProviderTarget: summary.byProviderTarget.map((provider, index) => ({
    ...provider,
    costUsd: totalCostUsd * [0.48, 0.34, 0.18][index],
    promptTokens: Math.round(provider.totalTokens * 0.76),
    completionTokens: Math.round(provider.totalTokens * 0.24),
  })),
}

const activeDays = daily.filter(entry => entry.totalTokens > 0)
const peakDay = activeDays.reduce((peak, entry) => entry.totalTokens > peak.totalTokens ? entry : peak)

const stats: UsageStats = {
  currentStreak: 11,
  longestStreak: 27,
  activeDays: activeDays.length,
  avgDailyTokens: Math.round(totalTokens / activeDays.length),
  peakDay: { date: peakDay.date, totalTokens: peakDay.totalTokens },
  todayTokens: daily.at(-1)?.totalTokens ?? 0,
  peakConcurrentRuns: 3,
}

export const populatedUsageDashboardFixture: UsageDashboardViewProps = {
  daily,
  dailyByModel,
  hourly,
  summary,
  stats,
  costSummary,
  dailyCost,
  tools: {
    overall: [
      { toolName: 'Read', count: 1240, successCount: 1230, failureCount: 8, deniedCount: 2, avgDurationMs: 45 },
      { toolName: 'Edit', count: 890, successCount: 880, failureCount: 10, deniedCount: 0, avgDurationMs: 120 },
      { toolName: 'Write', count: 450, successCount: 445, failureCount: 5, deniedCount: 0, avgDurationMs: 80 },
      { toolName: 'Bash', count: 320, successCount: 300, failureCount: 18, deniedCount: 2, avgDurationMs: 2500 },
      { toolName: 'Grep', count: 280, successCount: 280, failureCount: 0, deniedCount: 0, avgDurationMs: 30 },
    ],
    byRuntime: [
      { runtimeKind: 'opencode', tools: [
        { toolName: 'Read', count: 800, successCount: 795, failureCount: 5, deniedCount: 0, avgDurationMs: 40 },
        { toolName: 'Edit', count: 600, successCount: 595, failureCount: 5, deniedCount: 0, avgDurationMs: 110 },
      ]},
      { runtimeKind: 'codex', tools: [
        { toolName: 'Read', count: 440, successCount: 435, failureCount: 3, deniedCount: 2, avgDurationMs: 55 },
        { toolName: 'Edit', count: 290, successCount: 285, failureCount: 5, deniedCount: 0, avgDurationMs: 135 },
      ]},
    ],
    byModel: [
      { modelId: 'gpt-5.2', tools: [
        { toolName: 'Read', count: 600, successCount: 595, failureCount: 5, deniedCount: 0, avgDurationMs: 42 },
        { toolName: 'Edit', count: 420, successCount: 415, failureCount: 5, deniedCount: 0, avgDurationMs: 115 },
      ]},
      { modelId: 'claude-opus-4.6', tools: [
        { toolName: 'Read', count: 420, successCount: 418, failureCount: 2, deniedCount: 0, avgDurationMs: 48 },
        { toolName: 'Edit', count: 310, successCount: 308, failureCount: 2, deniedCount: 0, avgDurationMs: 125 },
      ]},
    ],
  },
  costEfficiency: daily.slice(-30).map((entry, index) => ({
    date: entry.date,
    totalTokens: entry.totalTokens,
    runCount: entry.count,
    avgTokensPerRun: entry.count > 0 ? Math.round(entry.totalTokens / entry.count) : 0,
    totalCostUsd: dailyCost.filter(c => c.date === entry.date).reduce((sum, c) => sum + c.costUsd, 0),
    avgCostPerRun: entry.count > 0 ? dailyCost.filter(c => c.date === entry.date).reduce((sum, c) => sum + c.costUsd, 0) / entry.count : 0,
  })),
  usageReady: true,
  themeMode: 'light',
}

export const emptyUsageDashboardFixture: UsageDashboardViewProps = {
  daily: [],
  dailyByModel: [],
  hourly: [],
  summary: {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalTurns: 0,
    byAgent: [],
    byProviderTarget: [],
    byModel: [],
  },
  stats: {
    currentStreak: 0,
    longestStreak: 0,
    activeDays: 0,
    avgDailyTokens: 0,
    peakDay: null,
    todayTokens: 0,
    peakConcurrentRuns: 0,
  },
  costSummary: null,
  dailyCost: [],
  tools: null,
  costEfficiency: [],
  usageReady: true,
  themeMode: 'light',
}

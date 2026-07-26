import { agents, backendRunSnapshotEvents, backendRunSnapshots, backendRuns, providerTargets, sessions, usageLogs } from '@cradle/db'
import { sql } from 'drizzle-orm'

import { db } from '../../infra'
import { reconcileCompletedCradleClaudeUsage } from '../chat-runtime-providers/claude-agent/usage-reconciliation'
import { estimateCost } from './pricing'

const usageTurnKey = sql`COALESCE(${usageLogs.runId}, ${usageLogs.providerTurnId}, ${usageLogs.id})`

export async function reconcileCompletedClaudeUsage(maxBindings?: number): Promise<{
  bindings: number
  transcripts: number
  inserted: number
  duplicates: number
  incidents: number
}> {
  return reconcileCompletedCradleClaudeUsage({ maxBindings })
}

export interface DailyUsage {
  date: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  count: number
}

export interface DailyUsageByModel {
  date: string
  modelId: string
  totalTokens: number
  count: number
}

export interface HourlyUsage {
  hour: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  count: number
}

export interface UsageSummary {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalTurns: number
  byAgent: Array<{ agentId: string, agentName: string, totalTokens: number, count: number }>
  byProviderTarget: Array<{ providerTargetId: string, providerTargetName: string | null, totalTokens: number, count: number }>
  byModel: Array<{ modelId: string, totalTokens: number, count: number }>
}

export function getDailyUsage(days = 365): DailyUsage[] {
  const rows = db().all<{
    date: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= unixepoch('now', 'localtime', '-' || ${days} || ' days')
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime')
    ORDER BY date ASC
  `)

  return rows.map(row => ({
    date: row.date,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    count: row.count,
  }))
}

// Same grain as getDailyUsage, plus a model_id dimension — powers the
// "which model" drill-down in heatmap/pattern tooltips on the usage
// dashboard. Runs are pre-model, so a row's model can be null; those are
// bucketed under 'unknown' rather than dropped, mirroring getDailyCost.
export function getDailyUsageByModel(days = 365): DailyUsageByModel[] {
  const rows = db().all<{
    date: string
    model_id: string
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= unixepoch('now', 'localtime', '-' || ${days} || ' days')
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime'), model_id
    ORDER BY date ASC, total_tokens DESC
  `)

  return rows.map(row => ({
    date: row.date,
    modelId: row.model_id,
    totalTokens: row.total_tokens,
    count: row.count,
  }))
}

export function getHourlyUsagePattern(): HourlyUsage[] {
  const rows = db().all<{
    hour: number
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      CAST(strftime('%H', ${usageLogs.createdAt}, 'unixepoch', 'localtime') AS INTEGER) AS hour,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    GROUP BY hour
    ORDER BY hour ASC
  `)

  const rowsByHour = new Map(rows.map(row => [row.hour, row]))
  return Array.from({ length: 24 }, (_, hour) => {
    const row = rowsByHour.get(hour)
    return {
      hour,
      promptTokens: row?.prompt_tokens ?? 0,
      completionTokens: row?.completion_tokens ?? 0,
      totalTokens: row?.total_tokens ?? 0,
      count: row?.count ?? 0,
    }
  })
}

export function getUsageSummary(): UsageSummary {
  const totals = db().get<{
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      COALESCE(SUM(${usageLogs.promptTokens}), 0) AS prompt_tokens,
      COALESCE(SUM(${usageLogs.completionTokens}), 0) AS completion_tokens,
      COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
  `)

  // Agent-level aggregation: usage_logs → sessions → agents
  const byAgent = db().all<{
    agent_id: string
    agent_name: string
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      ${agents.id} AS agent_id,
      ${agents.name} AS agent_name,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    INNER JOIN ${sessions} ON ${sessions.id} = ${usageLogs.sessionId}
    INNER JOIN ${agents} ON ${agents.id} = ${sessions.agentId}
    GROUP BY ${agents.id}, ${agents.name}
    ORDER BY total_tokens DESC
  `)

  // Provider-level aggregation (which provider endpoint handled the request)
  const byProviderTarget = db().all<{
    provider_target_id: string
    provider_target_name: string | null
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      ${usageLogs.providerTargetId} AS provider_target_id,
      ${providerTargets.displayName} AS provider_target_name,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    LEFT JOIN ${providerTargets} ON ${providerTargets.id} = ${usageLogs.providerTargetId}
    WHERE ${usageLogs.providerTargetId} IS NOT NULL
    GROUP BY ${usageLogs.providerTargetId}, ${providerTargets.displayName}
    ORDER BY total_tokens DESC
  `)

  const byModel = db().all<{
    model_id: string
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      ${usageLogs.modelId} AS model_id,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    WHERE ${usageLogs.modelId} IS NOT NULL
    GROUP BY ${usageLogs.modelId}
    ORDER BY total_tokens DESC
  `)

  return {
    totalPromptTokens: totals?.prompt_tokens ?? 0,
    totalCompletionTokens: totals?.completion_tokens ?? 0,
    totalTokens: totals?.total_tokens ?? 0,
    totalTurns: totals?.count ?? 0,
    byAgent: byAgent.map(row => ({
      agentId: row.agent_id,
      agentName: row.agent_name,
      totalTokens: row.total_tokens,
      count: row.count,
    })),
    byProviderTarget: byProviderTarget.map(row => ({
      providerTargetId: row.provider_target_id,
      providerTargetName: row.provider_target_name,
      totalTokens: row.total_tokens,
      count: row.count,
    })),
    byModel: byModel.map(row => ({
      modelId: row.model_id,
      totalTokens: row.total_tokens,
      count: row.count,
    })),
  }
}

export function getUsageStats(): {
  currentStreak: number
  longestStreak: number
  activeDays: number
  avgDailyTokens: number
  peakDay: { date: string, totalTokens: number } | null
  todayTokens: number
  peakConcurrentRuns: number
} {
  const activeDateRows = db().all<{ date: string }>(sql`
    SELECT DISTINCT date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date
    FROM ${usageLogs}
    ORDER BY date ASC
  `)

  const dates = activeDateRows.map(row => row.date)
  const activeDays = dates.length
  let currentStreak = 0
  let longestStreak = 0
  let streak = 0
  // Use local date to match the 'localtime' modifier in DB queries
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  if (dates.length > 0) {
    const todayDate = new Date(today)
    const lastActive = new Date(dates.at(-1)!)
    const daysSinceLast = Math.floor((todayDate.getTime() - lastActive.getTime()) / 86400000)

    if (daysSinceLast <= 1) {
      currentStreak = 1
      for (let index = dates.length - 2; index >= 0; index--) {
        const current = new Date(dates[index + 1])
        const previous = new Date(dates[index])
        const gap = Math.floor((current.getTime() - previous.getTime()) / 86400000)
        if (gap === 1) {
          currentStreak++
        }
        else {
          break
        }
      }
    }

    streak = 1
    longestStreak = 1
    for (let index = 1; index < dates.length; index++) {
      const current = new Date(dates[index])
      const previous = new Date(dates[index - 1])
      const gap = Math.floor((current.getTime() - previous.getTime()) / 86400000)
      if (gap === 1) {
        streak++
        if (streak > longestStreak) {
          longestStreak = streak
        }
      }
      else {
        streak = 1
      }
    }
  }

  const totalRow = db().get<{ total: number }>(sql`
    SELECT COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total FROM ${usageLogs}
  `)
  const avgDailyTokens = activeDays > 0 ? Math.round((totalRow?.total ?? 0) / activeDays) : 0

  const peakRow = db().get<{ date: string, total_tokens: number }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      SUM(${usageLogs.totalTokens}) AS total_tokens
    FROM ${usageLogs}
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime')
    ORDER BY total_tokens DESC
    LIMIT 1
  `)
  const peakDay = peakRow ? { date: peakRow.date, totalTokens: peakRow.total_tokens } : null

  const todayRow = db().get<{ total: number }>(sql`
    SELECT COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total
    FROM ${usageLogs}
    WHERE date(${usageLogs.createdAt}, 'unixepoch', 'localtime') = date('now', 'localtime')
  `)

  const { peakConcurrent } = getPeakConcurrentRuns()

  return {
    currentStreak,
    longestStreak,
    activeDays,
    avgDailyTokens,
    peakDay,
    todayTokens: todayRow?.total ?? 0,
    peakConcurrentRuns: peakConcurrent,
  }
}

export function getPeakConcurrentRuns(): { peakConcurrent: number } {
  const rows = db().all<{ started_at: number, finished_at: number | null }>(sql`
    SELECT ${backendRuns.startedAt} AS started_at, ${backendRuns.finishedAt} AS finished_at
    FROM ${backendRuns}
    ORDER BY ${backendRuns.startedAt} ASC
  `)

  if (rows.length === 0) {
    return { peakConcurrent: 0 }
  }

  const now = Math.floor(Date.now() / 1000)
  const events: Array<[number, 1] | [number, -1]> = []
  for (const row of rows) {
    events.push([row.started_at, 1])
    events.push([row.finished_at ?? now, -1])
  }

  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  let current = 0
  let peak = 0
  for (const [, delta] of events) {
    current += delta
    if (current > peak) {
      peak = current
    }
  }

  return { peakConcurrent: peak }
}

export function getSessionUsage(sessionId: string): {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  count: number
  byModel: Array<{
    modelId: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    turnCount: number
  }>
} {
  const row = db().get<{
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      COALESCE(SUM(${usageLogs.promptTokens}), 0) AS prompt_tokens,
      COALESCE(SUM(${usageLogs.completionTokens}), 0) AS completion_tokens,
      COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    WHERE ${usageLogs.sessionId} = ${sessionId}
  `)

  const byModel = db().all<{
    model_id: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    turn_count: number
  }>(sql`
    SELECT
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      COALESCE(SUM(${usageLogs.promptTokens}), 0) AS prompt_tokens,
      COALESCE(SUM(${usageLogs.completionTokens}), 0) AS completion_tokens,
      COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS turn_count
    FROM ${usageLogs}
    WHERE ${usageLogs.sessionId} = ${sessionId}
    GROUP BY ${usageLogs.modelId}
    ORDER BY total_tokens DESC, model_id ASC
  `)

  return {
    totalTokens: row?.total_tokens ?? 0,
    promptTokens: row?.prompt_tokens ?? 0,
    completionTokens: row?.completion_tokens ?? 0,
    count: row?.count ?? 0,
    byModel: byModel.map(model => ({
      modelId: model.model_id,
      promptTokens: model.prompt_tokens,
      completionTokens: model.completion_tokens,
      totalTokens: model.total_tokens,
      turnCount: model.turn_count,
    })),
  }
}

// ── Cost Dashboard queries ──
// Cost is calculated on-the-fly from usage_logs token counts × current model pricing.
// Uses usage_logs (always populated) instead of step_usage (may be empty for some providers).

export interface CostSummary {
  totalCostUsd: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  byModel: Array<{ modelId: string, costUsd: number, promptTokens: number, completionTokens: number, totalTokens: number, count: number }>
  byAgent: Array<{ agentId: string, agentName: string, costUsd: number, promptTokens: number, completionTokens: number, totalTokens: number, count: number }>
  byProviderTarget: Array<{ providerTargetId: string, providerTargetName: string | null, costUsd: number, promptTokens: number, completionTokens: number, totalTokens: number, count: number }>
}

interface CostBreakdownTotals {
  costUsd: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  count: number
}

function resolveTimeRange(from?: string, to?: string): { fromEpoch: number, toEpoch: number } {
  const fromEpoch = from ? Math.floor(new Date(from).getTime() / 1000) : 0
  const toEpoch = to ? Math.floor(new Date(to).getTime() / 1000) + 86400 : Math.floor(Date.now() / 1000) + 86400
  return { fromEpoch, toEpoch }
}

export function getCostSummary(from?: string, to?: string): CostSummary {
  const { fromEpoch, toEpoch } = resolveTimeRange(from, to)

  const rows = db().all<{
    model_id: string
    agent_id: string | null
    agent_name: string | null
    provider_target_id: string | null
    provider_target_name: string | null
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      ${sessions.agentId} AS agent_id,
      ${agents.name} AS agent_name,
      ${usageLogs.providerTargetId} AS provider_target_id,
      ${providerTargets.displayName} AS provider_target_name,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    INNER JOIN ${sessions} ON ${sessions.id} = ${usageLogs.sessionId}
    LEFT JOIN ${agents} ON ${agents.id} = ${sessions.agentId}
    LEFT JOIN ${providerTargets} ON ${providerTargets.id} = ${usageLogs.providerTargetId}
    WHERE ${usageLogs.createdAt} >= ${fromEpoch}
      AND ${usageLogs.createdAt} < ${toEpoch}
    GROUP BY
      ${usageLogs.modelId},
      ${sessions.agentId},
      ${agents.name},
      ${usageLogs.providerTargetId},
      ${providerTargets.displayName}
  `)

  const modelMap = new Map<string, CostBreakdownTotals>()
  const agentMap = new Map<string, CostBreakdownTotals & { agentName: string }>()
  const providerTargetMap = new Map<string, CostBreakdownTotals & { providerTargetName: string | null }>()

  for (const row of rows) {
    const costUsd = estimateCost(row.model_id, {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
    })
    addCostBreakdown(modelMap, row.model_id, {
      costUsd,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      count: row.count,
    })
    if (row.agent_id && row.agent_name) {
      addNamedCostBreakdown(agentMap, row.agent_id, 'agentName', row.agent_name, {
        costUsd,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        count: row.count,
      })
    }
    if (row.provider_target_id) {
      addNamedCostBreakdown(providerTargetMap, row.provider_target_id, 'providerTargetName', row.provider_target_name, {
        costUsd,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        count: row.count,
      })
    }
  }

  const byModel = Array.from(modelMap.entries())
    .map(([modelId, data]) => ({ modelId, ...data }))
    .sort((a, b) => b.costUsd - a.costUsd)
  const byAgent = Array.from(agentMap.entries())
    .map(([agentId, data]) => ({ agentId, ...data }))
    .sort((a, b) => b.costUsd - a.costUsd)
  const byProviderTarget = Array.from(providerTargetMap.entries())
    .map(([providerTargetId, data]) => ({ providerTargetId, ...data }))
    .sort((a, b) => b.costUsd - a.costUsd)

  return {
    totalCostUsd: byModel.reduce((sum, row) => sum + row.costUsd, 0),
    totalPromptTokens: byModel.reduce((sum, row) => sum + row.promptTokens, 0),
    totalCompletionTokens: byModel.reduce((sum, row) => sum + row.completionTokens, 0),
    totalTokens: byModel.reduce((sum, row) => sum + row.totalTokens, 0),
    byModel,
    byAgent,
    byProviderTarget,
  }
}

function addCostBreakdown(map: Map<string, CostBreakdownTotals>, key: string, data: CostBreakdownTotals): void {
  const current = map.get(key)
  if (!current) {
    map.set(key, { ...data })
    return
  }
  current.costUsd += data.costUsd
  current.promptTokens += data.promptTokens
  current.completionTokens += data.completionTokens
  current.totalTokens += data.totalTokens
  current.count += data.count
}

function addNamedCostBreakdown<NameKey extends string>(
  map: Map<string, CostBreakdownTotals & Record<NameKey, string | null>>,
  key: string,
  nameKey: NameKey,
  name: string | null,
  data: CostBreakdownTotals,
): void {
  const current = map.get(key)
  if (!current) {
    map.set(key, { ...data, [nameKey]: name } as CostBreakdownTotals & Record<NameKey, string | null>)
    return
  }
  current.costUsd += data.costUsd
  current.promptTokens += data.promptTokens
  current.completionTokens += data.completionTokens
  current.totalTokens += data.totalTokens
  current.count += data.count
}

export interface SessionCostEntry {
  sessionId: string
  costUsd: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  stepCount: number
}

export interface RecentUsageSession {
  sessionId: string
  title: string
  agentId: string | null
  agentName: string | null
  modelId: string
  costUsd: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  turnCount: number
  createdAt: number
  updatedAt: number
  lastUsageAt: number
}

export function getSessionsCost(from?: string, to?: string): SessionCostEntry[] {
  const { fromEpoch, toEpoch } = resolveTimeRange(from, to)

  const rows = db().all<{
    session_id: string
    model_id: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    step_count: number
  }>(sql`
    SELECT
      ${usageLogs.sessionId} AS session_id,
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS step_count
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= ${fromEpoch}
      AND ${usageLogs.createdAt} < ${toEpoch}
    GROUP BY ${usageLogs.sessionId}, ${usageLogs.modelId}
  `)

  const sessionMap = new Map<string, { costUsd: number, promptTokens: number, completionTokens: number, totalTokens: number, stepCount: number }>()
  for (const row of rows) {
    const cost = estimateCost(row.model_id, { promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens })
    const entry = sessionMap.get(row.session_id)
    if (entry) {
      entry.costUsd += cost
      entry.promptTokens += row.prompt_tokens
      entry.completionTokens += row.completion_tokens
      entry.totalTokens += row.total_tokens
      entry.stepCount += row.step_count
    }
    else {
      sessionMap.set(row.session_id, {
        costUsd: cost,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        stepCount: row.step_count,
      })
    }
  }

  return Array.from(sessionMap.entries())
    .map(([sessionId, data]) => ({ sessionId, ...data }))
    .sort((a, b) => b.costUsd - a.costUsd)
}

export function getRecentUsageSessions(limit = 6): RecentUsageSession[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20)

  const rows = db().all<{
    session_id: string
    title: string
    agent_id: string | null
    agent_name: string | null
    model_id: string
    cost_model_id: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    turn_count: number
    created_at: number
    updated_at: number
    last_usage_at: number
  }>(sql`
    WITH recent_sessions AS (
      SELECT
        usage_session_logs.session_id AS session_id,
        MAX(usage_session_logs.created_at) AS last_usage_at,
        (
          SELECT COALESCE(latest_usage_logs.model_id, 'unknown')
          FROM usage_logs latest_usage_logs
          WHERE latest_usage_logs.session_id = usage_session_logs.session_id
          ORDER BY latest_usage_logs.created_at DESC, latest_usage_logs.id DESC
          LIMIT 1
        ) AS model_id
      FROM usage_logs usage_session_logs
      GROUP BY usage_session_logs.session_id
      ORDER BY last_usage_at DESC
      LIMIT ${safeLimit}
    )
    SELECT
      recent_sessions.session_id AS session_id,
      ${sessions.title} AS title,
      ${sessions.agentId} AS agent_id,
      ${agents.name} AS agent_name,
      recent_sessions.model_id AS model_id,
      COALESCE(${usageLogs.modelId}, 'unknown') AS cost_model_id,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS turn_count,
      ${sessions.createdAt} AS created_at,
      ${sessions.updatedAt} AS updated_at,
      recent_sessions.last_usage_at AS last_usage_at
    FROM recent_sessions
    INNER JOIN ${usageLogs} ON ${usageLogs.sessionId} = recent_sessions.session_id
    INNER JOIN ${sessions} ON ${sessions.id} = recent_sessions.session_id
    LEFT JOIN ${agents} ON ${agents.id} = ${sessions.agentId}
    GROUP BY
      recent_sessions.session_id,
      ${sessions.title},
      ${sessions.agentId},
      ${agents.name},
      recent_sessions.model_id,
      cost_model_id,
      ${sessions.createdAt},
      ${sessions.updatedAt},
      recent_sessions.last_usage_at
    ORDER BY recent_sessions.last_usage_at DESC, recent_sessions.session_id ASC
  `)

  const sessionMap = new Map<string, RecentUsageSession>()
  for (const row of rows) {
    const costUsd = estimateCost(row.cost_model_id, {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
    })
    const current = sessionMap.get(row.session_id)
    if (current) {
      current.costUsd += costUsd
      current.promptTokens += row.prompt_tokens
      current.completionTokens += row.completion_tokens
      current.totalTokens += row.total_tokens
      current.turnCount += row.turn_count
      continue
    }
    sessionMap.set(row.session_id, {
      sessionId: row.session_id,
      title: row.title,
      agentId: row.agent_id,
      agentName: row.agent_name,
      modelId: row.model_id,
      costUsd,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      turnCount: row.turn_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsageAt: row.last_usage_at,
    })
  }

  return Array.from(sessionMap.values())
}

export interface DailyCostEntry {
  date: string
  modelId: string
  costUsd: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  stepCount: number
}

// One row per calendar day × model so the trend chart can stack cost by model
// the same way `/daily-by-model` stacks tokens. Callers that only need a daily
// total (hero KPIs) should sum costUsd across model rows for each date.
export function getDailyCost(from?: string, to?: string): DailyCostEntry[] {
  const { fromEpoch, toEpoch } = resolveTimeRange(from, to)

  const rows = db().all<{
    date: string
    model_id: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    step_count: number
  }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS step_count
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= ${fromEpoch}
      AND ${usageLogs.createdAt} < ${toEpoch}
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime'), ${usageLogs.modelId}
    ORDER BY date ASC, model_id ASC
  `)

  return rows.map(row => ({
    date: row.date,
    modelId: row.model_id,
    costUsd: estimateCost(row.model_id, { promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens }),
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    stepCount: row.step_count,
  }))
}

export function getTodayCostUsd(): number {
  const rows = db().all<{
    model_id: string
    prompt_tokens: number
    completion_tokens: number
  }>(sql`
    SELECT
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens
    FROM ${usageLogs}
    WHERE date(${usageLogs.createdAt}, 'unixepoch', 'localtime') = date('now', 'localtime')
    GROUP BY ${usageLogs.modelId}
  `)

  return rows.reduce(
    (sum, row) => sum + estimateCost(row.model_id, { promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens }),
    0,
  )
}

// ── Tool Usage Breakdown ──

export interface ToolUsageEntry {
  toolName: string
  count: number
  successCount: number
  failureCount: number
  deniedCount: number
  avgDurationMs: number | null
}

export interface ToolUsageByRuntime {
  runtimeKind: string
  tools: ToolUsageEntry[]
}

export interface ToolUsageByModel {
  modelId: string
  tools: ToolUsageEntry[]
}

export interface ToolUsageBreakdown {
  overall: ToolUsageEntry[]
  byRuntime: ToolUsageByRuntime[]
  byModel: ToolUsageByModel[]
}

export function getToolUsageBreakdown(): ToolUsageBreakdown {
  const toolEvents = db().all<{
    tool_name: string
    phase: string
    duration_ms: number | null
    runtime_kind: string
    model_id: string | null
  }>(sql`
    SELECT
      ${backendRunSnapshotEvents.toolName} AS tool_name,
      ${backendRunSnapshotEvents.phase} AS phase,
      ${backendRunSnapshotEvents.durationMs} AS duration_ms,
      ${backendRunSnapshots.runtimeKind} AS runtime_kind,
      ${backendRunSnapshots.modelId} AS model_id
    FROM ${backendRunSnapshotEvents}
    INNER JOIN ${backendRunSnapshots} ON ${backendRunSnapshots.id} = ${backendRunSnapshotEvents.snapshotId}
    WHERE ${backendRunSnapshotEvents.toolName} IS NOT NULL
      AND ${backendRunSnapshotEvents.toolName} != ''
  `)

  // Build overall breakdown
  const overallMap = new Map<string, { count: number, successCount: number, failureCount: number, deniedCount: number, totalDurationMs: number, durationCount: number }>()
  const runtimeMap = new Map<string, Map<string, { count: number, successCount: number, failureCount: number, deniedCount: number, totalDurationMs: number, durationCount: number }>>()
  const modelMap = new Map<string, Map<string, { count: number, successCount: number, failureCount: number, deniedCount: number, totalDurationMs: number, durationCount: number }>>()

  for (const event of toolEvents) {
    const toolName = event.tool_name
    const isFailure = event.phase === 'tool_call_output_failed' || event.phase === 'tool_call_input_failed'
    const isDenied = event.phase === 'tool_call_denied'
    const isSuccess = event.phase === 'tool_call_output_available'
    const durationMs = event.duration_ms ?? 0
    const hasDuration = durationMs > 0

    // Overall
    const overall = ensureToolEntry(overallMap, toolName)
    overall.count++
    if (isSuccess) { overall.successCount++ }
    if (isFailure) { overall.failureCount++ }
    if (isDenied) { overall.deniedCount++ }
    if (hasDuration) {
      overall.totalDurationMs += durationMs
      overall.durationCount++
    }

    // By runtime
    const runtimeTools = ensureNestedMap(runtimeMap, event.runtime_kind, toolName)
    runtimeTools.count++
    if (isSuccess) { runtimeTools.successCount++ }
    if (isFailure) { runtimeTools.failureCount++ }
    if (isDenied) { runtimeTools.deniedCount++ }
    if (hasDuration) {
      runtimeTools.totalDurationMs += durationMs
      runtimeTools.durationCount++
    }

    // By model
    const modelId = event.model_id ?? 'unknown'
    const modelTools = ensureNestedMap(modelMap, modelId, toolName)
    modelTools.count++
    if (isSuccess) { modelTools.successCount++ }
    if (isFailure) { modelTools.failureCount++ }
    if (isDenied) { modelTools.deniedCount++ }
    if (hasDuration) {
      modelTools.totalDurationMs += durationMs
      modelTools.durationCount++
    }
  }

  return {
    overall: mapToToolEntries(overallMap),
    byRuntime: Array.from(runtimeMap.entries())
      .map(([runtimeKind, tools]) => ({ runtimeKind, tools: mapToToolEntries(tools) }))
      .sort((a, b) => b.tools.reduce((s, t) => s + t.count, 0) - a.tools.reduce((s, t) => s + t.count, 0)),
    byModel: Array.from(modelMap.entries())
      .map(([modelId, tools]) => ({ modelId, tools: mapToToolEntries(tools) }))
      .sort((a, b) => b.tools.reduce((s, t) => s + t.count, 0) - a.tools.reduce((s, t) => s + t.count, 0)),
  }
}

type ToolAccumulator = { count: number, successCount: number, failureCount: number, deniedCount: number, totalDurationMs: number, durationCount: number }

function ensureToolEntry(map: Map<string, ToolAccumulator>, toolName: string): ToolAccumulator {
  let entry = map.get(toolName)
  if (!entry) {
    entry = { count: 0, successCount: 0, failureCount: 0, deniedCount: 0, totalDurationMs: 0, durationCount: 0 }
    map.set(toolName, entry)
  }
  return entry
}

function ensureNestedMap(
  outer: Map<string, Map<string, ToolAccumulator>>,
  outerKey: string,
  toolName: string,
): ToolAccumulator {
  let inner = outer.get(outerKey)
  if (!inner) {
    inner = new Map()
    outer.set(outerKey, inner)
  }
  return ensureToolEntry(inner, toolName)
}

function mapToToolEntries(map: Map<string, ToolAccumulator>): ToolUsageEntry[] {
  return Array.from(map.entries())
    .map(([toolName, data]) => ({
      toolName,
      count: data.count,
      successCount: data.successCount,
      failureCount: data.failureCount,
      deniedCount: data.deniedCount,
      avgDurationMs: data.durationCount > 0 ? Math.round(data.totalDurationMs / data.durationCount) : null,
    }))
    .sort((a, b) => b.count - a.count)
}

// ── Cost Efficiency Trend ──

export interface DailyCostEfficiency {
  date: string
  totalTokens: number
  runCount: number
  avgTokensPerRun: number
  totalCostUsd: number
  avgCostPerRun: number
}

export function getCostEfficiencyTrend(days = 90): DailyCostEfficiency[] {
  const rows = db().all<{
    date: string
    total_tokens: number
    run_count: number
    model_ids: string
    prompt_tokens: number
    completion_tokens: number
  }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT COALESCE(${usageLogs.runId}, ${usageLogs.providerTurnId}, ${usageLogs.id})) AS run_count,
      GROUP_CONCAT(DISTINCT COALESCE(${usageLogs.modelId}, 'unknown')) AS model_ids,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= unixepoch('now', 'localtime', '-' || ${days} || ' days')
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime')
    ORDER BY date ASC
  `)

  return rows.map((row) => {
    // Estimate cost from the model mix
    const modelIds = row.model_ids ? row.model_ids.split(',') : ['unknown']
    const promptPerModel = Math.round(row.prompt_tokens / Math.max(modelIds.length, 1))
    const completionPerModel = Math.round(row.completion_tokens / Math.max(modelIds.length, 1))
    const totalCostUsd = modelIds.reduce(
      (sum, modelId) => sum + estimateCost(modelId, { promptTokens: promptPerModel, completionTokens: completionPerModel }),
      0,
    )
    const avgTokensPerRun = row.run_count > 0 ? Math.round(row.total_tokens / row.run_count) : 0
    const avgCostPerRun = row.run_count > 0 ? totalCostUsd / row.run_count : 0

    return {
      date: row.date,
      totalTokens: row.total_tokens,
      runCount: row.run_count,
      avgTokensPerRun,
      totalCostUsd,
      avgCostPerRun,
    }
  })
}

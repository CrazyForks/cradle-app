// Reads global Usage API data for dashboard and profile surfaces.
import { useQuery } from '@tanstack/react-query'

import {
  getUsageCostDailyOptions,
  getUsageCostEfficiencyOptions,
  getUsageCostSummaryOptions,
  getUsageDailyByModelOptions,
  getUsageDailyOptions,
  getUsagePatternsHourlyOptions,
  getUsageStatsOptions,
  getUsageSummaryOptions,
  getUsageToolsOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetUsageCostDailyResponse,
  GetUsageCostEfficiencyResponse,
  GetUsageCostSummaryResponse,
  GetUsageDailyByModelResponse,
  GetUsageDailyResponse,
  GetUsagePatternsHourlyResponse,
  GetUsageStatsResponse,
  GetUsageSummaryResponse,
  GetUsageToolsResponse,
} from '~/api-gen/types.gen'

export type DailyUsage = GetUsageDailyResponse[number]
export type DailyUsageByModel = GetUsageDailyByModelResponse[number]
export type HourlyUsage = GetUsagePatternsHourlyResponse[number]
export type UsageSummary = GetUsageSummaryResponse
export type UsageStats = GetUsageStatsResponse
export type CostSummary = GetUsageCostSummaryResponse
export type DailyCost = GetUsageCostDailyResponse[number]
export type ToolUsageBreakdown = GetUsageToolsResponse
export type CostEfficiency = GetUsageCostEfficiencyResponse[number]

const EMPTY_DAILY_USAGE: GetUsageDailyResponse = []
const EMPTY_DAILY_USAGE_BY_MODEL: GetUsageDailyByModelResponse = []
const EMPTY_HOURLY_USAGE: GetUsagePatternsHourlyResponse = []
const EMPTY_DAILY_COST: GetUsageCostDailyResponse = []
const EMPTY_COST_EFFICIENCY: GetUsageCostEfficiencyResponse = []

export function useUsageOverview() {
  const dailyQuery = useQuery({
    ...getUsageDailyOptions({ query: { days: '365' } }),
  })
  const dailyByModelQuery = useQuery({
    ...getUsageDailyByModelOptions({ query: { days: '365' } }),
  })
  const hourlyQuery = useQuery({
    ...getUsagePatternsHourlyOptions(),
  })
  const summaryQuery = useQuery({
    ...getUsageSummaryOptions(),
  })
  const statsQuery = useQuery({
    ...getUsageStatsOptions(),
  })
  const costSummaryQuery = useQuery({
    ...getUsageCostSummaryOptions(),
  })
  const dailyCostQuery = useQuery({
    ...getUsageCostDailyOptions(),
  })
  const toolsQuery = useQuery({
    ...getUsageToolsOptions(),
  })
  const costEfficiencyQuery = useQuery({
    ...getUsageCostEfficiencyOptions({ query: { days: '90' } }),
  })

  const summary = summaryQuery.data ?? null

  return {
    dailyQuery,
    dailyByModelQuery,
    summaryQuery,
    statsQuery,
    costSummaryQuery,
    dailyCostQuery,
    toolsQuery,
    costEfficiencyQuery,
    daily: dailyQuery.data ?? EMPTY_DAILY_USAGE,
    // Model breakdown is a drill-down enhancement for tooltips, not core
    // dashboard data — deliberately excluded from `usageReady` below so a
    // slow/failing request for it can't blank out the whole page. Consumers
    // already treat an empty array as "no per-model detail available yet".
    dailyByModel: dailyByModelQuery.data ?? EMPTY_DAILY_USAGE_BY_MODEL,
    hourly: hourlyQuery.data ?? EMPTY_HOURLY_USAGE,
    summary,
    stats: statsQuery.data ?? null,
    costSummary: costSummaryQuery.data ?? null,
    dailyCost: dailyCostQuery.data ?? EMPTY_DAILY_COST,
    tools: toolsQuery.data ?? null,
    costEfficiency: costEfficiencyQuery.data ?? EMPTY_COST_EFFICIENCY,
    usageReady:
      dailyQuery.isSuccess
      && hourlyQuery.isSuccess
      && summaryQuery.isSuccess
      && statsQuery.isSuccess
      && costSummaryQuery.isSuccess
      && dailyCostQuery.isSuccess,
    hasData: Boolean(summary && summary.totalTokens > 0),
  }
}

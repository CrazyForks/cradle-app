// Cost efficiency — whether the workspace is getting more or less efficient
// per run. Leads with a summary strip (avg tokens/run, avg cost/run,
// runs/day, each compared against the previous period), then a trend chart
// with a Tokens/Cost metric toggle — cost per run used to be buried in a
// tooltip even though it's the point of the card. Follows the page's range
// selector (the hook fetches 365 days; narrowing is a client-side slice).
import { format, parseISO } from 'date-fns'
import type { EChartsOption, TooltipComponentFormatterCallbackParams } from 'echarts'
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import ReactECharts from 'echarts-for-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { formatTokenCount, formatUsd } from '~/lib/number-format'

import { AnimatedNumber } from './animated-number'
import { lastDateKeys } from './usage-date'
import { UsageDeltaBadge } from './usage-delta-badge'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'
import type { CostEfficiency } from './use-usage-overview'

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
])

type EfficiencyMetric = 'tokens' | 'cost'

const METRIC_COLOR: Record<EfficiencyMetric, string> = {
  tokens: '#14b8a6', // teal-500
  cost: '#10b981', // emerald-500
}

interface CostEfficiencyTrendProps {
  data: CostEfficiency[]
  hasCost: boolean
  range: UsageRangeKey
  themeMode: 'light' | 'dark'
}

export function CostEfficiencyTrend({ data, hasCost, range, themeMode }: CostEfficiencyTrendProps) {
  const { t } = useTranslation('usage')
  const isDark = themeMode === 'dark'
  const days = rangeDays(range)
  const [metric, setMetric] = useState<EfficiencyMetric>('tokens')
  const activeMetric: EfficiencyMetric = hasCost ? metric : 'tokens'

  const { windowData, summary } = useMemo(
    () => sliceEfficiencyWindow(data, days),
    [data, days],
  )

  if (windowData.length === 0) {
    return (
      <div>
        <EfficiencyHeader title={t('efficiency.title')} description={t('efficiency.description')} />
        <p className="mt-4 text-xs text-muted-foreground" data-testid="usage-efficiency-empty">
          {t('efficiency.empty')}
        </p>
      </div>
    )
  }

  const vsLabel = t('efficiency.vsPrevious', { days })

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <EfficiencyHeader title={t('efficiency.title')} description={t('efficiency.description')} />
        {hasCost && (
          <ToggleGroup
            type="single"
            value={activeMetric}
            onValueChange={(value) => {
              if (value === 'tokens' || value === 'cost') { setMetric(value) }
            }}
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-px rounded-md"
          >
            <ToggleGroupItem value="tokens" className="h-7 px-2.5 text-xs">{t('trend.toggleTokens')}</ToggleGroupItem>
            <ToggleGroupItem value="cost" className="h-7 px-2.5 text-xs">{t('trend.toggleCost')}</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <SummaryCell
          label={t('efficiency.avgTokens')}
          testId="usage-efficiency-avg-tokens"
          value={<AnimatedNumber value={summary.avgTokensPerRun} formatter={formatTokenCount} className="text-xl font-semibold tabular-nums text-foreground" />}
          delta={summary.avgTokensChangePct}
          deltaLabel={vsLabel}
        />
        {hasCost && (
          <SummaryCell
            label={t('efficiency.avgCost')}
            testId="usage-efficiency-avg-cost"
            value={<AnimatedNumber value={summary.avgCostPerRun} formatter={formatUsd} className="text-xl font-semibold tabular-nums text-foreground" />}
            delta={summary.avgCostChangePct}
            deltaLabel={vsLabel}
          />
        )}
        <SummaryCell
          label={t('efficiency.runsPerDay')}
          testId="usage-efficiency-runs-per-day"
          value={<AnimatedNumber value={summary.runsPerDay} formatter={value => value.toFixed(1)} className="text-xl font-semibold tabular-nums text-foreground" />}
          delta={summary.runsPerDayChangePct}
          deltaLabel={vsLabel}
        />
      </div>

      <div className="mt-4" data-testid="usage-efficiency-chart">
        <ReactECharts
          // Remount on metric switch so the two line series don't morph into
          // each other; range changes keep the instance and animate.
          key={activeMetric}
          echarts={echarts}
          option={buildEfficiencyOption({ data: windowData, metric: activeMetric, isDark, t })}
          notMerge={false}
          lazyUpdate
          style={{ height: 220, width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  )
}

function EfficiencyHeader({ title, description }: { title: string, description: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-teal-500" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

interface SummaryCellProps {
  label: string
  testId: string
  value: React.ReactNode
  delta: number | null
  deltaLabel: string
}

function SummaryCell({ label, testId, value, delta, deltaLabel }: SummaryCellProps) {
  return (
    <div className="min-w-[92px]" data-testid={testId}>
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <div className="mt-0.5">{value}</div>
      <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <UsageDeltaBadge changePct={delta} />
        <span className="truncate">{deltaLabel}</span>
      </div>
    </div>
  )
}

interface EfficiencySummary {
  avgTokensPerRun: number
  avgTokensChangePct: number | null
  avgCostPerRun: number
  avgCostChangePct: number | null
  runsPerDay: number
  runsPerDayChangePct: number | null
}

interface EfficiencyWindow {
  windowData: CostEfficiency[]
  summary: EfficiencySummary
}

/** Slices the trailing `days` window (plus the previous window for deltas) out of the 365-day series. */
function sliceEfficiencyWindow(data: CostEfficiency[], days: number): EfficiencyWindow {
  const currentKeys = new Set(lastDateKeys(days))
  const previousKeys = new Set(lastDateKeys(days * 2).slice(0, days))

  const current = data.filter(row => currentKeys.has(row.date))
  const previous = data.filter(row => previousKeys.has(row.date))

  const aggregate = (rows: CostEfficiency[]) => {
    const tokens = rows.reduce((acc, row) => acc + row.totalTokens, 0)
    const cost = rows.reduce((acc, row) => acc + row.totalCostUsd, 0)
    const runs = rows.reduce((acc, row) => acc + row.runCount, 0)
    return {
      runs,
      avgTokensPerRun: runs > 0 ? tokens / runs : 0,
      avgCostPerRun: runs > 0 ? cost / runs : 0,
      runsPerDay: runs / days,
    }
  }

  const currentAgg = aggregate(current)
  const previousAgg = aggregate(previous)
  const changePct = (currentValue: number, previousValue: number) =>
    previousAgg.runs > 0 && previousValue > 0
      ? ((currentValue - previousValue) / previousValue) * 100
      : null

  return {
    windowData: current,
    summary: {
      avgTokensPerRun: currentAgg.avgTokensPerRun,
      avgTokensChangePct: changePct(currentAgg.avgTokensPerRun, previousAgg.avgTokensPerRun),
      avgCostPerRun: currentAgg.avgCostPerRun,
      avgCostChangePct: changePct(currentAgg.avgCostPerRun, previousAgg.avgCostPerRun),
      runsPerDay: currentAgg.runsPerDay,
      runsPerDayChangePct: changePct(currentAgg.runsPerDay, previousAgg.runsPerDay),
    },
  }
}

interface EfficiencyOptionInput {
  data: CostEfficiency[]
  metric: EfficiencyMetric
  isDark: boolean
  t: ReturnType<typeof useTranslation<'usage'>>['t']
}

function buildEfficiencyOption({ data, metric, isDark, t }: EfficiencyOptionInput): EChartsOption {
  const muted = isDark ? '#a3a3a3' : '#737373'
  const gridline = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'
  const color = METRIC_COLOR[metric]
  const metricLabel = metric === 'cost' ? t('efficiency.avgCost') : t('efficiency.avgTokens')
  const runsLabel = t('efficiency.runsPerDay')
  const formatValue = metric === 'cost' ? formatUsd : formatTokenCount

  const dates = data.map(d => d.date)
  const metricValues = data.map(d => metric === 'cost' ? d.avgCostPerRun : d.avgTokensPerRun)
  const runCounts = data.map(d => d.runCount)

  return {
    animation: true,
    animationDuration: 600,
    animationEasing: 'cubicOut',
    grid: { top: 32, left: 8, right: 8, bottom: 8 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', crossStyle: { color: muted } },
      backgroundColor: '#0a0a0a',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: '#fff', fontSize: 11 },
      extraCssText: 'border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);',
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const arr = Array.isArray(params) ? params : [params]
        if (!arr.length) {
          return ''
        }
        const date = arr[0].name
        const idx = dates.indexOf(date!)
        const value = idx >= 0 ? metricValues[idx] : 0
        const runs = idx >= 0 ? runCounts[idx] : 0
        const dateLine = date ? `${format(parseISO(date), 'PP')}<br/>` : ''
        return `${dateLine}${metricLabel}  <b>${formatValue(value)}</b><br/>${runsLabel}  <b>${runs}</b>`
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: muted,
        fontSize: 10,
        hideOverlap: true,
        formatter: (v: string) => format(parseISO(v), dates.length > 60 ? 'MMM' : 'MMM d'),
      },
    },
    yAxis: [
      {
        type: 'value',
        name: metricLabel,
        nameTextStyle: { color: muted, fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: muted,
          fontSize: 10,
          formatter: (v: number) => formatValue(v),
        },
        splitLine: { lineStyle: { color: gridline, type: 'dashed' } },
      },
      {
        type: 'value',
        name: runsLabel,
        nameTextStyle: { color: muted, fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: muted, fontSize: 10 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: metricLabel,
        type: 'line',
        data: metricValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${color}26` },
              { offset: 1, color: `${color}00` },
            ],
          },
        },
      },
      {
        name: runsLabel,
        type: 'bar',
        yAxisIndex: 1,
        data: runCounts,
        barMaxWidth: 12,
        itemStyle: {
          color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          borderRadius: [2, 2, 0, 0],
        },
      },
    ],
  }
}

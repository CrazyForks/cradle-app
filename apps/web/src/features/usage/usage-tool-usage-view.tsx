// Tool usage — redesigned around outcomes rather than raw frequency. The old
// card only showed a share bar and a (broken) success rate; this view leads
// with a summary strip (total calls, success rate, tools used, avg duration)
// plus an outcome composition bar, then a per-day stacked trend of the top
// tools, and finally the ranked per-tool list with drill-down by runtime and
// model. Counts are real tool CALLS (aggregated per toolCallId server-side),
// so success/failure/denied/interrupted and durations are trustworthy.
import { format, parseISO } from 'date-fns'
import type { EChartsOption, TooltipComponentFormatterCallbackParams } from 'echarts'
import { BarChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import ReactECharts from 'echarts-for-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ScrollArea } from '~/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'
import { formatShortDurationMs } from '~/lib/number-format'

import { AnimatedNumber } from './animated-number'
import { denseToolStackSeries, OTHER_MODEL_KEY } from './usage-insights'
import { categoryColor } from './usage-palette'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'
import type { ToolUsageBreakdown, ToolUsageEntry } from './use-usage-overview'

// Tree-shake: register only the pieces we use (same pattern as the hero trend
// chart) so echarts stays small.
echarts.use([
  BarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

type BreakdownDimension = 'overall' | 'runtime' | 'model'

// Fixed semantic hues for call outcomes (not the categorical palette): these
// read as status, same role success/destructive play elsewhere in the app.
const OUTCOME_COLOR = {
  success: '#10b981', // emerald-500
  failure: '#f43f5e', // rose-500
  denied: '#f59e0b', // amber-500
  interrupted: '#a3a3a3', // neutral-400
} as const

interface UsageToolUsageViewProps {
  tools: ToolUsageBreakdown
  range: UsageRangeKey
  themeMode: 'light' | 'dark'
}

export function UsageToolUsageView({ tools, range, themeMode }: UsageToolUsageViewProps) {
  const { t } = useTranslation('usage')
  const [dimension, setDimension] = useState<BreakdownDimension>('overall')

  const { summary } = tools
  const hasRuntime = tools.byRuntime.length > 0
  const hasModel = tools.byModel.length > 0

  const availableDimensions = useMemo(() => {
    const dims: BreakdownDimension[] = ['overall']
    if (hasRuntime) { dims.push('runtime') }
    if (hasModel) { dims.push('model') }
    return dims
  }, [hasRuntime, hasModel])

  return (
    <div data-testid="usage-tool-usage">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500" />
            <h2 className="text-sm font-semibold text-foreground">{t('tools.title')}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('tools.description')}</p>
        </div>
        {availableDimensions.length > 1 && (
          <ToggleGroup
            type="single"
            value={dimension}
            onValueChange={(value) => { if (value) { setDimension(value as BreakdownDimension) } }}
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-px rounded-md"
          >
            <ToggleGroupItem value="overall" className="h-7 px-2.5 text-xs">{t('tools.dimension.overall')}</ToggleGroupItem>
            {hasRuntime && <ToggleGroupItem value="runtime" className="h-7 px-2.5 text-xs">{t('tools.dimension.runtime')}</ToggleGroupItem>}
            {hasModel && <ToggleGroupItem value="model" className="h-7 px-2.5 text-xs">{t('tools.dimension.model')}</ToggleGroupItem>}
          </ToggleGroup>
        )}
      </div>

      {summary.totalCalls === 0
        ? (
            <p className="mt-6 text-xs text-muted-foreground" data-testid="usage-tool-usage-empty">
              {t('tools.empty')}
            </p>
          )
        : (
            <>
              <SummaryStrip summary={summary} />
              <OutcomeCompositionBar summary={summary} />
              {tools.daily.length > 0 && (
                <ToolCallTrend daily={tools.daily} range={range} themeMode={themeMode} />
              )}

              <div className="mt-5">
                {dimension === 'overall' && (
                  <ToolList tools={tools.overall} />
                )}
                {dimension === 'runtime' && hasRuntime && (
                  <div className="space-y-4">
                    {tools.byRuntime.map(runtime => (
                      <ToolGroup key={runtime.runtimeKind} label={runtime.runtimeKind} tools={runtime.tools} />
                    ))}
                  </div>
                )}
                {dimension === 'model' && hasModel && (
                  <div className="space-y-4">
                    {tools.byModel.map(model => (
                      <ToolGroup key={model.modelId} label={model.modelId} tools={model.tools} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
    </div>
  )
}

type ToolSummary = ToolUsageBreakdown['summary']

function SummaryStrip({ summary }: { summary: ToolSummary }) {
  const { t } = useTranslation('usage')
  const cells: Array<{ label: string, value: React.ReactNode, testId: string }> = [
    {
      label: t('tools.totalCalls'),
      value: <AnimatedNumber value={summary.totalCalls} formatter={value => value.toLocaleString()} className="text-xl font-semibold tabular-nums text-foreground" />,
      testId: 'usage-tools-total-calls',
    },
    {
      label: t('tools.summary.successRate'),
      value: <AnimatedNumber value={summary.successRatePct} formatter={value => `${value.toFixed(1)}%`} className="text-xl font-semibold tabular-nums text-foreground" />,
      testId: 'usage-tools-success-rate',
    },
    {
      label: t('tools.summary.uniqueTools'),
      value: <AnimatedNumber value={summary.uniqueToolCount} formatter={value => String(value)} className="text-xl font-semibold tabular-nums text-foreground" />,
      testId: 'usage-tools-unique',
    },
    {
      label: t('tools.summary.medianDuration'),
      value: (
        <span className="text-xl font-semibold tabular-nums text-foreground">
          {summary.medianDurationMs != null ? formatShortDurationMs(summary.medianDurationMs) : '—'}
        </span>
      ),
      testId: 'usage-tools-avg-duration',
    },
  ]

  return (
    <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
      {cells.map(cell => (
        <div key={cell.testId} className="min-w-[92px]" data-testid={cell.testId}>
          <p className="text-[10.5px] text-muted-foreground">{cell.label}</p>
          <div className="mt-0.5">{cell.value}</div>
        </div>
      ))}
    </div>
  )
}

// Thin full-width bar showing what share of calls succeeded / failed / were
// denied / got interrupted, with count chips underneath. Denied and
// interrupted are excluded from the success-rate denominator (they never
// produced an outcome) but still shown here — they're real signal.
function OutcomeCompositionBar({ summary }: { summary: ToolSummary }) {
  const { t } = useTranslation('usage')
  const segments = [
    { key: 'success', count: summary.successCount, color: OUTCOME_COLOR.success },
    { key: 'failure', count: summary.failureCount, color: OUTCOME_COLOR.failure },
    { key: 'denied', count: summary.deniedCount, color: OUTCOME_COLOR.denied },
    { key: 'interrupted', count: summary.interruptedCount, color: OUTCOME_COLOR.interrupted },
  ].filter(segment => segment.count > 0)

  return (
    <div className="mt-3">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/6">
        {segments.map(segment => (
          <div
            key={segment.key}
            className="h-full transition-[width] duration-300"
            style={{
              width: `${(segment.count / summary.totalCalls) * 100}%`,
              backgroundColor: segment.color,
            }}
          />
        ))}
      </div>
      {(summary.failureCount > 0 || summary.deniedCount > 0 || summary.interruptedCount > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {summary.failureCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: OUTCOME_COLOR.failure }} />
              {t('tools.outcome.failed', { count: summary.failureCount })}
            </span>
          )}
          {summary.deniedCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: OUTCOME_COLOR.denied }} />
              {t('tools.outcome.denied', { count: summary.deniedCount })}
            </span>
          )}
          {summary.interruptedCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: OUTCOME_COLOR.interrupted }} />
              {t('tools.outcome.interrupted', { count: summary.interruptedCount })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

interface ToolCallTrendProps {
  daily: ToolUsageBreakdown['daily']
  range: UsageRangeKey
  themeMode: 'light' | 'dark'
}

function ToolCallTrend({ daily, range, themeMode }: ToolCallTrendProps) {
  const { t } = useTranslation('usage')
  const isDark = themeMode === 'dark'
  const days = rangeDays(range)
  const stack = useMemo(() => denseToolStackSeries(daily, days), [daily, days])

  const option = useMemo<EChartsOption>(() => {
    const muted = isDark ? '#a3a3a3' : '#737373'
    const gridline = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'
    const shadow = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
    const dates = stack.series.map(d => String(d.date))
    const label = (toolName: string) => toolName === OTHER_MODEL_KEY ? t('tools.otherTools') : toolName

    return {
      animation: true,
      animationDuration: 600,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 400,
      animationEasingUpdate: 'cubicInOut',
      legend: {
        type: 'scroll',
        top: 0,
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 12,
        textStyle: { color: muted, fontSize: 11 },
        inactiveColor: isDark ? '#525252' : '#d4d4d4',
      },
      grid: { top: 34, left: 8, right: 8, bottom: 8 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: shadow } },
        backgroundColor: '#0a0a0a',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: '#fff', fontSize: 11 },
        extraCssText: 'border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);',
        formatter: (params: TooltipComponentFormatterCallbackParams) => {
          const arr = Array.isArray(params) ? params : [params]
          if (!arr.length) { return '' }
          const date = arr[0].name
          const total = arr.reduce((acc, p) => acc + Number(p.value ?? 0), 0)
          const rows = arr
            .filter(p => Number(p.value ?? 0) > 0)
            .map(p => `${p.marker ?? ''}${p.seriesName ?? ''}  <b>${Number(p.value).toLocaleString()}</b>`)
            .join('<br/>')
          return `${date ? `${format(parseISO(date), 'PP')}<br/>` : ''}${t('tools.trend.total')}  <b>${total.toLocaleString()}</b><br/>${rows}`
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
          formatter: (value: string) => format(parseISO(value), days > 90 ? 'MMM' : 'MMM d'),
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: gridline, type: 'dashed' } },
      },
      series: stack.models.map((toolName, index) => ({
        name: label(toolName),
        type: 'bar' as const,
        stack: 'calls',
        data: stack.series.map(d => Number(d[toolName] ?? 0)),
        itemStyle: {
          color: toolName === OTHER_MODEL_KEY ? muted : categoryColor(index),
          borderRadius: index === stack.models.length - 1 ? [3, 3, 0, 0] : 0,
        },
        barMaxWidth: 24,
        emphasis: { focus: 'series' as const },
      })),
    }
  }, [stack, days, isDark, t])

  return (
    <div className="mt-5" data-testid="usage-tool-trend">
      <p className="text-[11px] font-medium text-muted-foreground">{t('tools.trend.title')}</p>
      <ReactECharts
        echarts={echarts}
        option={option}
        notMerge={false}
        lazyUpdate
        style={{ height: 200, width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  )
}

/** Per-tool success rate over calls that produced an outcome; null when every call was denied/interrupted. */
function successRate(tool: ToolUsageEntry): number | null {
  const terminal = tool.successCount + tool.failureCount
  return terminal > 0 ? (tool.successCount / terminal) * 100 : null
}

function ToolGroup({ label, tools }: { label: string, tools: ToolUsageEntry[] }) {
  const { t } = useTranslation('usage')
  const totalCalls = tools.reduce((acc, tool) => acc + tool.count, 0)
  const success = tools.reduce((acc, tool) => acc + tool.successCount, 0)
  const failure = tools.reduce((acc, tool) => acc + tool.failureCount, 0)
  const rate = success + failure > 0 ? Math.round((success / (success + failure)) * 100) : null

  return (
    <div>
      <h3 className="mb-2 flex items-baseline gap-2 text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
        <span>{label}</span>
        <span className="normal-case tabular-nums text-muted-foreground/70">
          {t('tools.groupSummary', { calls: totalCalls.toLocaleString(), rate: rate ?? '—' })}
        </span>
      </h3>
      <ToolList tools={tools} />
    </div>
  )
}

function ToolList({ tools }: { tools: ToolUsageEntry[] }) {
  const total = tools.reduce((acc, tool) => acc + tool.count, 0)

  return (
    <ScrollArea className="min-w-0 max-h-64 pr-2" viewportClassName="max-h-64" contentClassName="space-y-1">
      {tools.map((tool, index) => (
        <ToolRow key={tool.toolName} tool={tool} index={index} total={total} />
      ))}
    </ScrollArea>
  )
}

function ToolRow({ tool, index, total }: { tool: ToolUsageEntry, index: number, total: number }) {
  const { t } = useTranslation('usage')
  const share = total > 0 ? tool.count / total : 0
  const color = categoryColor(index)
  const rate = successRate(tool)
  const hasDuration = tool.medianDurationMs != null && tool.medianDurationMs > 0

  return (
    <div className="relative min-w-0 overflow-hidden rounded-lg">
      <div
        className="absolute inset-y-0 left-0 rounded-lg transition-[width] duration-300"
        style={{ width: `${Math.max(share * 100, 1.5)}%`, backgroundColor: color, opacity: 0.12 }}
      />
      <div className="relative flex items-center justify-between gap-3 px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="min-w-0 truncate font-mono text-xs text-foreground">{tool.toolName}</span>
        </span>
        <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">
          {tool.count.toLocaleString()}
        </span>
      </div>
      <div className="relative flex items-center justify-between gap-3 px-2.5 pb-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={cn(
            'tabular-nums',
            rate === null
              ? 'text-muted-foreground/70'
              : rate >= 90 ? 'text-success' : rate >= 70 ? 'text-amber-500' : 'text-destructive',
          )}
          >
            {rate === null ? '—' : `${rate.toFixed(0)}%`}
          </span>
          {hasDuration && (
            <span className="text-muted-foreground/70">
              ·
              {formatShortDurationMs(tool.medianDurationMs!)}
            </span>
          )}
          {tool.failureCount > 0 && (
            <span className="text-destructive/70">
              ·
              {t('tools.outcome.failed', { count: tool.failureCount })}
            </span>
          )}
          {tool.deniedCount > 0 && (
            <span className="text-muted-foreground/70">
              ·
              {t('tools.outcome.denied', { count: tool.deniedCount })}
            </span>
          )}
          {tool.interruptedCount > 0 && (
            <span className="text-muted-foreground/70">
              ·
              {t('tools.outcome.interrupted', { count: tool.interruptedCount })}
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums">
{(share * 100).toFixed(1)}
%
        </span>
      </div>
    </div>
  )
}

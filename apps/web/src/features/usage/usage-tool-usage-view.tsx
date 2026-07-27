// Tool usage — redesigned around outcomes rather than raw frequency. The old
// card only showed a share bar and a (broken) success rate; this view leads
// with a summary strip (total calls, success rate, tools used, avg duration)
// plus an outcome composition bar, then — in Overall mode — a day × tool
// activity heatmap and the ranked per-tool list. The By-runtime / By-model
// modes swap the heatmap for a side-by-side "VS" comparison (small multiples,
// up to 4 columns: each its own mini heatmap + ranked list), since tool sets
// are not unified across dimensions. Counts are real tool CALLS (aggregated
// per toolCallId server-side), so success/failure/denied/interrupted and
// durations are trustworthy.
import { format, parseISO } from 'date-fns'
import type { EChartsOption, TooltipComponentFormatterCallbackParams } from 'echarts'
import { HeatmapChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
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
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
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
              {dimension === 'overall' && tools.daily.length > 0 && (
                <ToolCallTrend daily={tools.daily} range={range} themeMode={themeMode} />
              )}
              {dimension === 'runtime' && hasRuntime && (
                <ToolCompare
                  key="runtime"
                  groups={tools.byRuntime.map(g => ({ key: g.runtimeKind, tools: g.tools }))}
                  title={t('tools.compare.titleRuntime')}
                  // `?? []`: an older server build doesn't send these fields
                  // yet — degrade to list-only compare instead of crashing.
                  dailyBy={(tools.dailyByRuntime ?? []).map(r => ({ groupKey: r.runtimeKind, date: r.date, toolName: r.toolName, count: r.count }))}
                  range={range}
                  themeMode={themeMode}
                />
              )}
              {dimension === 'model' && hasModel && (
                <ToolCompare
                  key="model"
                  groups={tools.byModel.map(g => ({ key: g.modelId, tools: g.tools }))}
                  title={t('tools.compare.titleModel')}
                  dailyBy={(tools.dailyByModel ?? []).map(r => ({ groupKey: r.modelId, date: r.date, toolName: r.toolName, count: r.count }))}
                  range={range}
                  themeMode={themeMode}
                />
              )}

              {dimension === 'overall' && (
                <div className="mt-5">
                  <ToolList tools={tools.overall} />
                </div>
              )}
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

// Shared heatmap scale: single amber hue (the section's accent) from a faint
// wash to full saturation. One hue keeps multi-row matrices readable — a
// categorical palette per row turns a heatmap into confetti.
const HEATMAP_RANGE: [string, string] = ['rgba(245,158,11,0.07)', '#f59e0b']

const HEATMAP_TOOLTIP = {
  backgroundColor: '#0a0a0a',
  borderColor: 'rgba(255,255,255,0.1)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#fff', fontSize: 11 },
  extraCssText: 'border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);',
}

type ToolStack = ReturnType<typeof denseToolStackSeries>

/**
 * Shared option builder for the day × tool heatmaps (the big trend chart and
 * the per-column small multiples). `max` is injected so each chart controls
 * its own intensity normalization.
 */
function buildToolHeatmapOption(args: {
  stack: ToolStack
  days: number
  max: number
  isDark: boolean
  compact: boolean
  label: (toolName: string) => string
}): EChartsOption {
  const { stack, days, max, isDark, compact, label } = args
  const muted = isDark ? '#a3a3a3' : '#737373'
  const dates = stack.series.map(d => String(d.date))
  // Rows top-to-bottom in ranked order; echarts category y-axis renders
  // bottom-up, so feed it reversed.
  const tools = [...stack.models].reverse()
  const rowIndex = new Map(tools.map((toolName, index) => [toolName, index]))

  const data: Array<[number, number, number]> = []
  stack.series.forEach((datum, dateIndex) => {
    stack.models.forEach((toolName) => {
      data.push([dateIndex, rowIndex.get(toolName)!, Number(datum[toolName] ?? 0)])
    })
  })

  return {
    animation: true,
    animationDuration: 600,
    animationEasing: 'cubicOut',
    grid: compact
      ? { top: 2, left: 2, right: 2, bottom: 2, containLabel: true }
      : { top: 8, left: 8, right: 8, bottom: 8, containLabel: true },
    tooltip: {
      ...HEATMAP_TOOLTIP,
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const p = Array.isArray(params) ? params[0] : params
        const [dateIndex, toolIndex, count] = (p?.value ?? [0, 0, 0]) as [number, number, number]
        const date = dates[dateIndex]
        const tool = tools[toolIndex]
        return `${date ? `${format(parseISO(date), 'PP')}<br/>` : ''}<b>${label(tool)}</b>  ${Number(count).toLocaleString()}`
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
      axisLabel: compact
        ? { show: false }
        : {
            color: muted,
            fontSize: 10,
            hideOverlap: true,
            formatter: (value: string) => format(parseISO(value), days > 90 ? 'MMM' : 'MMM d'),
          },
    },
    yAxis: {
      type: 'category',
      data: tools.map(label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: compact
        ? { color: muted, fontSize: 9, fontFamily: 'ui-monospace, monospace', width: 72, overflow: 'truncate' }
        : { color: muted, fontSize: 10, fontFamily: 'ui-monospace, monospace' },
    },
    visualMap: {
      show: false,
      min: 0,
      max: Math.max(max, 1),
      inRange: { color: HEATMAP_RANGE },
    },
    series: [{
      type: 'heatmap' as const,
      data,
      itemStyle: {
        borderColor: isDark ? '#0a0a0a' : '#ffffff',
        borderWidth: compact ? 1 : 2,
        borderRadius: compact ? 2 : 3,
      },
      emphasis: {
        itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.35)' },
      },
    }],
  }
}

function stackMax(stack: ToolStack): number {
  let max = 0
  for (const datum of stack.series) {
    for (const toolName of stack.models) {
      const count = Number(datum[toolName] ?? 0)
      if (count > max) { max = count }
    }
  }
  return max
}

interface ToolCallTrendProps {
  daily: ToolUsageBreakdown['daily']
  range: UsageRangeKey
  themeMode: 'light' | 'dark'
}

/** Day × tool activity heatmap: rows are the top tools, cells are call counts. */
function ToolCallTrend({ daily, range, themeMode }: ToolCallTrendProps) {
  const { t } = useTranslation('usage')
  const isDark = themeMode === 'dark'
  const days = rangeDays(range)
  const stack = useMemo(() => denseToolStackSeries(daily, days), [daily, days])

  const option = useMemo<EChartsOption>(() => buildToolHeatmapOption({
    stack,
    days,
    max: stackMax(stack),
    isDark,
    compact: false,
    label: toolName => toolName === OTHER_MODEL_KEY ? t('tools.otherTools') : toolName,
  }), [stack, days, isDark, t])

  return (
    <div className="mt-5" data-testid="usage-tool-trend">
      <p className="text-[11px] font-medium text-muted-foreground">{t('tools.trend.title')}</p>
      <ReactECharts
        echarts={echarts}
        option={option}
        notMerge={false}
        lazyUpdate
        style={{ height: stack.models.length * 28 + 56, width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  )
}

/**
 * Compact day × tool heatmap for one compare column. X labels are hidden to
 * keep the small multiples tight (all columns share the same day axis and
 * range). Intensity is normalized by THIS column's own peak cell — runtimes
 * differ too much in volume for a shared scale to leave small ones readable.
 */
function MiniToolHeatmap({ stack, days, themeMode }: {
  stack: ToolStack
  days: number
  themeMode: 'light' | 'dark'
}) {
  const option = useMemo<EChartsOption>(() => buildToolHeatmapOption({
    stack,
    days,
    max: stackMax(stack),
    isDark: themeMode === 'dark',
    compact: true,
    label: toolName => toolName,
  }), [stack, days, themeMode])

  return (
    <ReactECharts
      echarts={echarts}
      option={option}
      notMerge={false}
      lazyUpdate
      style={{ height: stack.models.length * 18 + 12, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

const COMPARE_MAX = 4

// Static column-count → grid-class map (Tailwind can't purge dynamic names).
const COMPARE_GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
}

/** One group's daily tool-call rows, pre-projected by the parent (runtimeKind / modelId → groupKey). */
interface CompareDailyRow {
  groupKey: string
  date: string
  toolName: string
  count: number
}

interface ToolCompareProps {
  groups: Array<{ key: string, tools: ToolUsageEntry[] }>
  title: string
  dailyBy: CompareDailyRow[]
  range: UsageRangeKey
  themeMode: 'light' | 'dark'
}

/**
 * Side-by-side "VS" comparison of up to COMPARE_MAX runtimes (or models) —
 * small multiples: each column gets its own mini day × tool heatmap (scaled
 * to that column's own peak) plus its own ranked tool list. Tool sets are NOT
 * unified across dimensions, so each column keeps its own axis instead of
 * forcing a shared one.
 */
function ToolCompare({ groups, title, dailyBy, range, themeMode }: ToolCompareProps) {
  const { t } = useTranslation('usage')
  const days = rangeDays(range)
  const [selected, setSelected] = useState<string[]>(() => groups.slice(0, COMPARE_MAX).map(g => g.key))

  const toggle = (key: string) => {
    setSelected(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : prev.length < COMPARE_MAX ? [...prev, key] : prev)
  }

  // Column order follows the group's ranking, not click order.
  const shown = groups.filter(g => selected.includes(g.key))

  // One dense stack per shown group; each column normalizes intensity by its
  // own peak (runtime volumes differ too much for a shared scale).
  const columnStacks = useMemo(() => {
    const stacks = new Map<string, ToolStack>()
    for (const group of shown) {
      const rows = dailyBy
        .filter(row => row.groupKey === group.key)
        .map(({ date, toolName, count }) => ({ date, toolName, count }))
      stacks.set(group.key, denseToolStackSeries(rows, days, 5))
    }
    return stacks
  }, [shown, dailyBy, days])

  return (
    <div className="mt-5" data-testid="usage-tool-compare">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
        <span className="text-[10px] text-muted-foreground/60">{t('tools.compare.hint', { max: COMPARE_MAX })}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {groups.map((group) => {
          const active = selected.includes(group.key)
          const disabled = !active && selected.length >= COMPARE_MAX
          return (
            <button
              key={group.key}
              type="button"
              disabled={disabled}
              onClick={() => toggle(group.key)}
              data-testid="usage-tool-compare-chip"
              data-active={active}
              className={cn(
                'h-6 max-w-48 truncate rounded-full border px-2.5 font-mono text-[11px] transition-colors',
                active
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-40 hover:border-border hover:text-muted-foreground',
              )}
            >
              {group.key}
            </button>
          )
        })}
      </div>
      {shown.length === 0
        ? <p className="mt-4 text-xs text-muted-foreground">{t('tools.compare.empty')}</p>
        : (
            <div className={cn('mt-3 grid gap-4', COMPARE_GRID_COLS[shown.length] ?? COMPARE_GRID_COLS[4])}>
              {shown.map(group => (
                <ToolCompareColumn
                  key={group.key}
                  label={group.key}
                  tools={group.tools}
                  stack={columnStacks.get(group.key)!}
                  days={days}
                  themeMode={themeMode}
                />
              ))}
            </div>
          )}
    </div>
  )
}

function ToolCompareColumn({ label, tools, stack, days, themeMode }: {
  label: string
  tools: ToolUsageEntry[]
  stack: ToolStack
  days: number
  themeMode: 'light' | 'dark'
}) {
  const totalCalls = tools.reduce((acc, tool) => acc + tool.count, 0)

  return (
    <div className="min-w-0">
      <h3 className="mb-2 flex items-baseline gap-2 text-[11px] font-medium text-muted-foreground">
        <span className="min-w-0 truncate font-mono">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground/70">
          {totalCalls.toLocaleString()}
        </span>
      </h3>
      <MiniToolHeatmap stack={stack} days={days} themeMode={themeMode} />
      <div className="mt-2">
        <ToolList tools={tools} />
      </div>
    </div>
  )
}

/** Per-tool success rate over calls that produced an outcome; null when every call was denied/interrupted. */
function successRate(tool: ToolUsageEntry): number | null {
  const terminal = tool.successCount + tool.failureCount
  return terminal > 0 ? (tool.successCount / terminal) * 100 : null
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

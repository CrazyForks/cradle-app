// Cost efficiency trend — line chart showing average tokens per run and
// average cost per run over time, revealing whether the workspace is
// becoming more or less efficient at using tokens per task.
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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { formatTokenCount, formatUsd } from '~/lib/number-format'

import type { CostEfficiency } from './use-usage-overview'

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
])

interface CostEfficiencyTrendProps {
  data: CostEfficiency[]
  hasCost: boolean
  themeMode: 'light' | 'dark'
}

export function CostEfficiencyTrend({ data, hasCost, themeMode }: CostEfficiencyTrendProps) {
  const { t } = useTranslation('usage')
  const isDark = themeMode === 'dark'

  const labels = useMemo(() => ({
    avgTokens: t('efficiency.avgTokens'),
    runsPerDay: t('efficiency.runsPerDay'),
    avgCost: t('efficiency.avgCost'),
  }), [t])

  const option = useMemo(
    () => buildEfficiencyOption({ data, hasCost, isDark, labels }),
    [data, hasCost, isDark, labels],
  )

  if (data.length === 0) {
    return null
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-teal-500" />
        <h2 className="text-sm font-semibold text-foreground">{t('efficiency.title')}</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('efficiency.description')}</p>

      <div className="mt-4" data-testid="usage-efficiency-chart">
        <ReactECharts
          echarts={echarts}
          option={option}
          notMerge={false}
          lazyUpdate
          style={{ height: 220, width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  )
}

interface EfficiencyOptionInput {
  data: CostEfficiency[]
  hasCost: boolean
  isDark: boolean
  labels: { avgTokens: string, runsPerDay: string, avgCost: string }
}

function buildEfficiencyOption({ data, hasCost, isDark, labels }: EfficiencyOptionInput): EChartsOption {
  const muted = isDark ? '#a3a3a3' : '#737373'
  const gridline = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'

  const dates = data.map(d => d.date)
  const avgTokens = data.map(d => d.avgTokensPerRun)
  const runCounts = data.map(d => d.runCount)

  const animation = {
    animation: true,
    animationDuration: 600,
    animationEasing: 'cubicOut' as const,
  }

  const tooltipBase = {
    trigger: 'axis' as const,
    axisPointer: { type: 'cross' as const, crossStyle: { color: muted } },
    backgroundColor: '#0a0a0a',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: '#fff', fontSize: 11 },
    extraCssText: 'border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);',
  }

  const categoryAxis = {
    type: 'category' as const,
    data: dates,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: muted,
      fontSize: 10,
      hideOverlap: true,
      formatter: (v: string) => format(parseISO(v), dates.length > 60 ? 'MMM' : 'MMM d'),
    },
  }

  const tokensAxis = {
    type: 'value' as const,
    name: labels.avgTokens,
    nameTextStyle: { color: muted, fontSize: 10 },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: muted,
      fontSize: 10,
      formatter: (v: number) => formatTokenCount(v),
    },
    splitLine: { lineStyle: { color: gridline, type: 'dashed' as const } },
  }

  const runsAxis = {
    type: 'value' as const,
    name: labels.runsPerDay,
    nameTextStyle: { color: muted, fontSize: 10 },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: muted, fontSize: 10 },
    splitLine: { show: false },
  }

  const series: EChartsOption['series'] = [
    {
      name: labels.avgTokens,
      type: 'line',
      data: avgTokens,
      smooth: true,
      symbol: 'circle',
      symbolSize: 4,
      lineStyle: { color: '#14b8a6', width: 2 },
      itemStyle: { color: '#14b8a6' },
      areaStyle: {
        color: {
          type: 'linear' as const,
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(20,184,166,0.15)' },
            { offset: 1, color: 'rgba(20,184,166,0)' },
          ],
        },
      },
    },
    {
      name: labels.runsPerDay,
      type: 'bar',
      yAxisIndex: 1,
      data: runCounts,
      barMaxWidth: 12,
      itemStyle: {
        color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        borderRadius: [2, 2, 0, 0],
      },
    },
  ]

  return {
    ...animation,
    grid: { top: 32, left: 8, right: 8, bottom: 8 },
    tooltip: {
      ...tooltipBase,
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const arr = Array.isArray(params) ? params : [params]
        if (!arr.length) {
          return ''
        }
        const date = arr[0].name
        const tokenEntry = arr.find(p => p.seriesName === labels.avgTokens)
        const runsEntry = arr.find(p => p.seriesName === labels.runsPerDay)
        const tokens = tokenEntry ? Number(tokenEntry.value) : 0
        const runs = runsEntry ? Number(runsEntry.value) : 0
        const idx = dates.indexOf(date!)
        const costLine = hasCost && idx >= 0
          ? `<br/>${labels.avgCost}  <b>${formatUsd(data[idx].avgCostPerRun)}</b>`
          : ''
        return `${date ? `${format(parseISO(date), 'PP')}<br/>` : ''}`
          + `${labels.avgTokens}  <b>${formatTokenCount(tokens)}</b><br/>`
          + `${labels.runsPerDay}  <b>${runs}</b>`
          + costLine
      },
    },
    xAxis: categoryAxis,
    yAxis: [tokensAxis, runsAxis],
    series,
  }
}

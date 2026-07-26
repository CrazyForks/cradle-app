// Tool usage breakdown — shows which tools are used most, with drill-down
// by runtime and model. Uses the same card-based layout as UsageBreakdown
// but focused on tool call frequency and success/failure rates.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ScrollArea } from '~/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'

import { categoryColor } from './usage-palette'
import type { ToolUsageBreakdown as ToolUsageData } from './use-usage-overview'

type BreakdownDimension = 'overall' | 'runtime' | 'model'

interface ToolBreakdownProps {
  tools: ToolUsageData
}

export function ToolBreakdown({ tools }: ToolBreakdownProps) {
  const { t } = useTranslation('usage')
  const [dimension, setDimension] = useState<BreakdownDimension>('overall')

  const hasRuntime = tools.byRuntime.length > 0
  const hasModel = tools.byModel.length > 0

  const availableDimensions = useMemo(() => {
    const dims: BreakdownDimension[] = ['overall']
    if (hasRuntime) { dims.push('runtime') }
    if (hasModel) { dims.push('model') }
    return dims
  }, [hasRuntime, hasModel])

  const totalToolCalls = tools.overall.reduce((sum, tool) => sum + tool.count, 0)

  if (totalToolCalls === 0) {
    return null
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500" />
            <h2 className="text-sm font-semibold text-foreground">{t('tools.title')}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('tools.description')}</p>
        </div>
        <div className="text-right">
          {availableDimensions.length > 1 && (
            <ToggleGroup
              type="single"
              value={dimension}
              onValueChange={(value) => { if (value) { setDimension(value as BreakdownDimension) } }}
              variant="outline"
              size="sm"
              className="ml-auto h-7 shrink-0 gap-px rounded-md"
            >
              <ToggleGroupItem value="overall" className="h-7 px-2.5 text-xs">{t('tools.dimension.overall')}</ToggleGroupItem>
              {hasRuntime && <ToggleGroupItem value="runtime" className="h-7 px-2.5 text-xs">{t('tools.dimension.runtime')}</ToggleGroupItem>}
              {hasModel && <ToggleGroupItem value="model" className="h-7 px-2.5 text-xs">{t('tools.dimension.model')}</ToggleGroupItem>}
            </ToggleGroup>
          )}
          <p className="text-2xl font-semibold tabular-nums text-foreground mt-2">
            {totalToolCalls.toLocaleString()}
          </p>
          <p className="text-[10.5px] text-muted-foreground">{t('tools.totalCalls')}</p>
        </div>
      </div>

      <div className="mt-5">
        {dimension === 'overall' && (
          <ToolList tools={tools.overall} />
        )}
        {dimension === 'runtime' && hasRuntime && (
          <div className="space-y-4">
            {tools.byRuntime.map((runtime) => (
              <div key={runtime.runtimeKind}>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                  {runtime.runtimeKind}
                </h3>
                <ToolList tools={runtime.tools} />
              </div>
            ))}
          </div>
        )}
        {dimension === 'model' && hasModel && (
          <div className="space-y-4">
            {tools.byModel.map((model) => (
              <div key={model.modelId}>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                  {model.modelId}
                </h3>
                <ToolList tools={model.tools} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface ToolItem {
  toolName: string
  count: number
  successCount: number
  failureCount: number
  deniedCount: number
  avgDurationMs: number | null
}

function ToolList({ tools }: { tools: ToolItem[] }) {
  const total = tools.reduce((sum, tool) => sum + tool.count, 0)

  return (
    <ScrollArea className="min-w-0 max-h-64 pr-2" viewportClassName="max-h-64" contentClassName="space-y-1">
      {tools.map((tool, index) => (
        <ToolRow key={tool.toolName} tool={tool} index={index} total={total} />
      ))}
    </ScrollArea>
  )
}

function ToolRow({ tool, index, total }: { tool: ToolItem, index: number, total: number }) {
  const share = total > 0 ? tool.count / total : 0
  const color = categoryColor(index)
  const successRate = tool.count > 0 ? (tool.successCount / tool.count) * 100 : 0
  const hasDuration = tool.avgDurationMs != null && tool.avgDurationMs > 0

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
            successRate >= 90 ? 'text-success' : successRate >= 70 ? 'text-amber-500' : 'text-destructive',
          )}>
            {successRate.toFixed(0)}%
          </span>
          {hasDuration && (
            <span className="text-muted-foreground/70">
              ·
              {tool.avgDurationMs! < 1000
                ? `${tool.avgDurationMs}ms`
                : `${(tool.avgDurationMs! / 1000).toFixed(1)}s`}
            </span>
          )}
          {tool.failureCount > 0 && (
            <span className="text-destructive/70">
              ·
              {tool.failureCount}
              {' '}
              failed
            </span>
          )}
          {tool.deniedCount > 0 && (
            <span className="text-muted-foreground/70">
              ·
              {tool.deniedCount}
              {' '}
              denied
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums">{(share * 100).toFixed(1)}%</span>
      </div>
    </div>
  )
}

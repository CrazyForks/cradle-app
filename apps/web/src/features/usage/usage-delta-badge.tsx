// Small up/down percentage badge comparing the current range against the
// period immediately before it. Shared by the hero cards and the cost
// efficiency summary strip.
import { TrendingDownLine, TrendingUpLine } from '@mingcute/react'

import { cn } from '~/lib/cn'

export function UsageDeltaBadge({ changePct }: { changePct: number | null }) {
  if (changePct === null) {
    return null
  }
  const rounded = Math.round(changePct)
  if (rounded === 0) {
    return <span className="tabular-nums text-muted-foreground/70">·</span>
  }
  const isUp = rounded > 0
  const TrendIcon = isUp ? TrendingUpLine : TrendingDownLine
  return (
    <span className={cn('flex items-center gap-0.5 font-medium tabular-nums', isUp ? 'text-success' : 'text-muted-foreground')}>
      <TrendIcon className="!size-3 shrink-0" />
      {Math.abs(rounded)}
%
    </span>
  )
}

import { RightSmallLine as ChevronRightIcon, TargetLine as TargetIcon } from '@mingcute/react'
import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

export function SteerMessageLabel() {
  const { t } = useTranslation('chat')
  return (
    <div className="mb-1 flex justify-end pr-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {t('continuation.steer.label')}
      </span>
    </div>
  )
}

export function ThinkingPlaceholder() {
  const { t } = useTranslation('chat')

  return (
    <div
      data-testid="message-bubble-thinking-placeholder"
      className="mt-3 flex h-6 w-full items-center overflow-hidden text-xs text-muted-foreground/70"
      aria-live="polite"
    >
      <span
        className={cn(
          'inline-flex items-center font-medium',
          '[mask-image:linear-gradient(90deg,rgba(0,0,0,0.4)_0%,black_36%,black_64%,rgba(0,0,0,0.4)_100%)] [mask-size:220%_100%]',
          '[-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0.4)_0%,black_36%,black_64%,rgba(0,0,0,0.4)_100%)] [-webkit-mask-size:220%_100%]',
          'animate-[shimmer_2.8s_linear_infinite]',
        )}
      >
        {t('status.thinking')}
      </span>
    </div>
  )
}

export function GoalMessageLabel() {
  return (
    <div className="mb-1 flex justify-end pr-1">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground/60">
        <TargetIcon className="size-3" aria-hidden="true" />
        Goal
      </span>
    </div>
  )
}

const FOLD_CHEVRON_SPRING = { stiffness: 600, damping: 40 } as const

/**
 * Collapsed execution-phase group. Reads as one faded feed-style row —
 * "Worked for 14s" with an inline chevron — matching the activity feed rows
 * instead of a standalone button.
 */
export function ExecutionPhaseFold({
  children,
  defaultOpen = false,
  durationMs,
}: {
  children: ReactNode
  defaultOpen?: boolean
  durationMs?: number | null
}) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const workedLabel = durationMs != null && durationMs >= 1000
    ? `for ${Math.round(durationMs / 1000)}s`
    : null

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full min-w-0 items-baseline text-left',
          'text-sm leading-relaxed',
          'cursor-default transition-opacity duration-[var(--duration-quick)] hover:opacity-80',
        )}
      >
        <span className="text-[var(--text-secondary)]">Worked</span>
        {workedLabel && (
          <span className="ml-1 min-w-0 text-[var(--text-tertiary)]">{workedLabel}</span>
        )}
        <m.span
          className="ml-1 inline-flex shrink-0 items-center"
          initial={false}
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={FOLD_CHEVRON_SPRING}
        >
          <ChevronRightIcon className="size-3 !text-[var(--text-dim)]" aria-hidden />
        </m.span>
      </button>
      {expanded && (
        <m.div
          className="flex flex-col gap-0.5"
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={FOLD_CHEVRON_SPRING}
        >
          {children}
        </m.div>
      )}
    </div>
  )
}

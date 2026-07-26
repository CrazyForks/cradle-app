import { CheckLine as CheckIcon } from '@mingcute/react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

/**
 * Issue selection checkbox.
 *
 * The board previously drew this as a `pointer-events-none` decoration, so the one
 * affordance that looks clickable was the one thing you could not click — selection
 * was reachable only via modifier-click or the `x` key.
 */
export function SelectionToggle({
  selected,
  onToggle,
  label,
}: {
  selected: boolean
  onToggle?: () => void
  label: string
}) {
  const { t } = useTranslation('kanban')

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onToggle?.()
  }

  const className = cn(
    'relative z-20 flex size-4 shrink-0 items-center justify-center rounded border text-primary',
    'transition-[opacity,background-color,border-color] duration-100',
    selected
      ? 'border-primary bg-primary/10 opacity-100'
      : 'border-border bg-background opacity-0 group-hover/card:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100',
  )

  if (!onToggle) {
    return (
      <span className={cn(className, 'pointer-events-none')} aria-hidden="true">
        {selected && <CheckIcon className="size-3" aria-hidden="true" />}
      </span>
    )
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={
        selected ? t('selection.deselectAria', { title: label }) : t('selection.selectAria', { title: label })
      }
      onClick={handleClick}
      className={cn(className, 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring')}
    >
      {selected && <CheckIcon className="size-3" aria-hidden="true" />}
    </button>
  )
}

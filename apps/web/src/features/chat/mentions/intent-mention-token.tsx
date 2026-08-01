import { CommandLine as CommandIcon } from '@mingcute/react'

import { cn } from '~/lib/cn'

export const INTENT_MENTION_TOKEN_CLASS
  = 'inline-flex items-center gap-0.5 align-baseline text-[0.8125em] font-medium text-violet-600 dark:text-violet-400'

export function formatIntentMentionTokenLabel(name: string): string {
  return `/${name.replace(/^\/+/, '')}`
}

export function IntentMentionToken({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <span className={cn(INTENT_MENTION_TOKEN_CLASS, className)}>
      <CommandIcon size={10} />
{' '}
{formatIntentMentionTokenLabel(name)}
    </span>
  )
}

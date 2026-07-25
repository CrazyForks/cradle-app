import { Combobox as ComboboxPrimitive } from '@base-ui/react'
import { PlusLine as PlusIcon } from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/cn'

import type { PullRequestDetail } from './api/pull-requests'

type People = PullRequestDetail['pullRequest']['assignees']

export interface PullRequestPeopleEditorViewProps {
  people: People
  pending: boolean
  assignableUsers: Array<{ login: string, avatarUrl?: string }>
  empty: string
  addLabel: string
  onAdd: (login: string) => void
  onRemove: (login: string) => void
}

export function PullRequestPeopleEditorView({
  people,
  pending,
  assignableUsers,
  empty,
  addLabel,
  onAdd,
  onRemove,
}: PullRequestPeopleEditorViewProps) {
  const { t } = useTranslation('pull-requests')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const assigned = new Set(people.map(person => person.login))
  const candidates = assignableUsers.filter(user => !assigned.has(user.login))
  const avatarByLogin = new Map(candidates.map(user => [user.login, user.avatarUrl]))

  function close() {
    setOpen(false)
    setQuery('')
  }

  return (
    <>
      {people.length === 0
        ? <span className="font-normal text-muted-foreground/60">{empty}</span>
        : null}
      {people.map(person => (
        <button
          key={person.login}
          type="button"
          disabled={pending}
          onClick={() => onRemove(person.login)}
          className={cn(
            'inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-normal text-foreground',
            !pending && 'hover:bg-muted/80',
          )}
          title={t('console.people.remove')}
        >
          <Avatar size="sm" className="size-4">
            {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-[9px]">{person.login.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span>{person.login}</span>
          <span aria-hidden className="text-muted-foreground">×</span>
        </button>
      ))}

      <ComboboxPrimitive.Root
        open={open}
        onOpenChange={nextOpen => (nextOpen ? setOpen(true) : close())}
        items={candidates.map(user => user.login)}
        value={null}
        inputValue={query}
        onInputValueChange={setQuery}
        onValueChange={(login) => {
          if (login) {
            onAdd(login)
          }
          close()
        }}
        autoHighlight
        modal={false}
      >
        <ComboboxPrimitive.Trigger
          disabled={pending}
          aria-label={addLabel}
          className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-fill hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <PlusIcon className="size-3" aria-hidden="true" />
        </ComboboxPrimitive.Trigger>
        <ComboboxPrimitive.Portal>
          <ComboboxPrimitive.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50">
            <ComboboxPrimitive.Popup className="w-60 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover p-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
              <ComboboxPrimitive.Input
                render={<Input className="h-7 text-xs" />}
                placeholder={t('console.people.loginPlaceholder')}
                aria-label={addLabel}
              />
              <ComboboxPrimitive.List className="no-scrollbar mt-1 max-h-56 overflow-y-auto overscroll-contain data-empty:mt-0">
                {candidates.map(user => (
                  <ComboboxPrimitive.Item
                    key={user.login}
                    value={user.login}
                    className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  >
                    <Avatar size="sm" className="size-4">
                      {avatarByLogin.get(user.login)
                        ? <AvatarImage src={avatarByLogin.get(user.login)} alt="" />
                        : null}
                      <AvatarFallback className="text-[9px]">{user.login.slice(0, 1).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">{user.login}</span>
                  </ComboboxPrimitive.Item>
                ))}
              </ComboboxPrimitive.List>
              <ComboboxPrimitive.Empty className="px-2 py-5 text-center text-xs text-muted-foreground empty:hidden">
                {t('console.people.noUsers')}
              </ComboboxPrimitive.Empty>
            </ComboboxPrimitive.Popup>
          </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
      </ComboboxPrimitive.Root>
    </>
  )
}

import {
  FilterLine as FilterIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { cn } from '~/lib/cn'

import type {
  PullRequestRepositoryOption,
  PullRequestStateFilter,
} from './pull-request-list-presenter'
import {
  matchesPullRequestState,
  PULL_REQUEST_STATE_FILTERS,
} from './pull-request-list-presenter'
import type { CradlePullRequest } from './use-pull-requests'

export interface PullRequestListFilterMenuViewProps {
  stateFilter: PullRequestStateFilter
  repository: string | null
  repositories: PullRequestRepositoryOption[]
  pullRequests: CradlePullRequest[]
  onStateChange: (state: PullRequestStateFilter) => void
  onRepositoryChange: (repository: string | null) => void
}

export function PullRequestListFilterMenuView({
  stateFilter,
  repository,
  repositories,
  pullRequests,
  onStateChange,
  onRepositoryChange,
}: PullRequestListFilterMenuViewProps) {
  const { t } = useTranslation('pull-requests')
  const filtering = stateFilter !== 'all' || repository !== null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={t('filter.menu.label')}
          className={cn(
            'mb-1 gap-1.5 px-2',
            filtering ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <FilterIcon className="size-3.5" aria-hidden="true" />
          {stateFilter === 'all' ? t('filter.menu.label') : t(`filter.state.${stateFilter}`)}
          {repository
            ? (
                <span className="max-w-32 truncate text-muted-foreground/70">
                  {repository}
                </span>
              )
            : null}
          {filtering
            ? <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="">{t('filter.state.label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={stateFilter}
          onValueChange={value => onStateChange(value as PullRequestStateFilter)}
        >
          {PULL_REQUEST_STATE_FILTERS.map((value) => {
            const count = pullRequests.filter(item => matchesPullRequestState(item, value)).length
            return (
              <DropdownMenuRadioItem key={value} value={value} className="gap-2 ">
                <span className="flex-1">{t(`filter.state.${value}`)}</span>
                <span className="tabular-nums text-muted-foreground/70">{count}</span>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        {repositories.length > 1
          ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="">{t('filter.repository.label')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={repository ?? 'all'}
                  onValueChange={value => onRepositoryChange(value === 'all' ? null : value)}
                >
                  <DropdownMenuRadioItem value="all" className="gap-2 ">
                    <span className="flex-1">{t('filter.repository.all')}</span>
                    <span className="tabular-nums text-muted-foreground/70">{pullRequests.length}</span>
                  </DropdownMenuRadioItem>
                  {repositories.map(option => (
                    <DropdownMenuRadioItem key={option.id} value={option.id} className="gap-2 ">
                      <img src={option.avatarUrl} alt="" className="size-4 rounded-full" />
                      <span className="flex-1 truncate">{option.id}</span>
                      <span className="tabular-nums text-muted-foreground/70">{option.count}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            )
          : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import {
  CheckCircleLine as CheckCircleIcon,
  EyeLine as ReviewIcon,
  GitCommitLine as GitCommitIcon,
  GitCompareLine as FileDiffIcon,
  Message1Line as CommentIcon,
  User2Line as UserAssignIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { AssetMarkdown } from '~/features/assets/asset-markdown'
import { cn } from '~/lib/cn'

import type { PullRequestDetail } from './api/pull-requests'
import { PullRequestCheckBadgeView } from './pull-request-check-badge-view'
import { PullRequestChecksValueView } from './pull-request-checks-value-view'
import { PullRequestCommentComposerView } from './pull-request-comment-composer-view'
import type { PullRequestReviewEvent } from './pull-request-header-actions-view'
import {
  PullRequestHeaderActionsView,
} from './pull-request-header-actions-view'
import { PullRequestPeopleEditorView } from './pull-request-people-editor-view'
import { PullRequestPeopleValueView } from './pull-request-people-value-view'
import { PullRequestPropertyRowView } from './pull-request-property-row-view'
import { PullRequestSectionHeadingView } from './pull-request-section-heading-view'
import { PullRequestSummaryHeaderView } from './pull-request-summary-header-view'
import { PullRequestTimelineEntryView } from './pull-request-timeline-entry-view'

type PullRequest = PullRequestDetail['pullRequest']

export interface PullRequestActionsPending {
  comment: boolean
  review: boolean
  merge: boolean
  readyDraft: boolean
  assignees: boolean
  reviewers: boolean
}

export interface PullRequestActionsViewProps {
  pullRequest: PullRequest
  assignableUsers: Array<{ login: string, avatarUrl?: string }>
  pending: PullRequestActionsPending
  onComment: (body: string) => void
  onReview: (event: PullRequestReviewEvent, body?: string) => void
  onMerge: (method: PullRequest['allowedMergeMethods'][number], commit?: { title?: string, message?: string }) => void
  onToggleReadyDraft: () => void
  onAddAssignee: (login: string) => void
  onRemoveAssignee: (login: string) => void
  onAddReviewer: (login: string) => void
  onRemoveReviewer: (login: string) => void
}

export interface PullRequestSummaryViewProps {
  detail: PullRequestDetail
  now: number
  locale: string
  actions?: PullRequestActionsViewProps
}

export function PullRequestSummaryView({
  detail,
  now,
  locale,
  actions,
}: PullRequestSummaryViewProps) {
  const { t } = useTranslation('pull-requests')
  const pullRequest = detail.pullRequest
  const canAct = actions !== undefined && pullRequest.state === 'open' && !pullRequest.merged

  return (
    <div className="pt-5">
      {canAct
        ? (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3">
              <PullRequestSummaryHeaderView pullRequest={pullRequest} now={now} />
              <PullRequestHeaderActionsView
                pullRequest={pullRequest}
                pending={actions.pending}
                onReview={actions.onReview}
                onMerge={actions.onMerge}
                onToggleReadyDraft={actions.onToggleReadyDraft}
              />
            </div>
          )
        : <PullRequestSummaryHeaderView pullRequest={pullRequest} now={now} />}

      <div className="space-y-8 pt-6">
        <dl>
          <PullRequestPropertyRowView icon={GitCommitIcon} label={t('summary.commits')}>
            <span className="tabular-nums">{pullRequest.commits}</span>
          </PullRequestPropertyRowView>
          <PullRequestPropertyRowView icon={CommentIcon} label={t('summary.comments')}>
            <span className="tabular-nums">
              {pullRequest.comments + pullRequest.reviewComments}
            </span>
          </PullRequestPropertyRowView>
          <PullRequestPropertyRowView icon={FileDiffIcon} label={t('summary.changedFiles')}>
            <span className="tabular-nums">{pullRequest.changedFiles}</span>
            <span className="ml-2 font-mono text-[11px] text-success">
              +
              {pullRequest.additions}
            </span>
            <span className="font-mono text-[11px] text-destructive">
              -
              {pullRequest.deletions}
            </span>
          </PullRequestPropertyRowView>
          <PullRequestPropertyRowView icon={CheckCircleIcon} label={t('summary.checks')}>
            <PullRequestChecksValueView
              state={pullRequest.checksState}
              count={pullRequest.checks.length}
            />
          </PullRequestPropertyRowView>
          <PullRequestPropertyRowView icon={UserAssignIcon} label={t('summary.assignees')}>
            {canAct
              ? (
                  <PullRequestPeopleEditorView
                    people={pullRequest.assignees}
                    pending={actions.pending.assignees}
                    assignableUsers={actions.assignableUsers}
                    empty={t('summary.noAssignees')}
                    addLabel={t('console.people.addAssignee')}
                    onAdd={actions.onAddAssignee}
                    onRemove={actions.onRemoveAssignee}
                  />
                )
              : (
                  <PullRequestPeopleValueView
                    people={pullRequest.assignees}
                    empty={t('summary.noAssignees')}
                  />
                )}
          </PullRequestPropertyRowView>
          <PullRequestPropertyRowView icon={ReviewIcon} label={t('summary.reviewers')}>
            {canAct
              ? (
                  <PullRequestPeopleEditorView
                    people={pullRequest.reviewers}
                    pending={actions.pending.reviewers}
                    assignableUsers={actions.assignableUsers}
                    empty={t('summary.noReviewers')}
                    addLabel={t('console.people.addReviewer')}
                    onAdd={actions.onAddReviewer}
                    onRemove={actions.onRemoveReviewer}
                  />
                )
              : (
                  <PullRequestPeopleValueView
                    people={pullRequest.reviewers}
                    empty={t('summary.noReviewers')}
                  />
                )}
          </PullRequestPropertyRowView>
        </dl>

        <section>
          <PullRequestSectionHeadingView>
            {t('summary.description')}
          </PullRequestSectionHeadingView>
          {pullRequest.body
            ? (
                <AssetMarkdown
                  content={pullRequest.body}
                  className="text-pretty text-[14px] leading-7 text-foreground/85"
                />
              )
            : (
                <p className="text-[13px] italic text-muted-foreground/70">
                  {t('summary.noDescription')}
                </p>
              )}
        </section>

        {pullRequest.checks.length > 0
          ? (
              <section>
                <PullRequestSectionHeadingView>
                  {t('summary.checks')}
                </PullRequestSectionHeadingView>
                <div className="divide-y divide-border/40">
                  {pullRequest.checks.map(check => (
                    <a
                      key={check.id}
                      href={check.url ?? undefined}
                      target={check.url ? '_blank' : undefined}
                      rel={check.url ? 'noreferrer' : undefined}
                      className={cn(
                        'flex min-h-9 items-center justify-between gap-3 py-2 text-[12.5px] transition-colors',
                        check.url && 'hover:text-foreground',
                      )}
                    >
                      <span className="truncate text-foreground/80">{check.name}</span>
                      <PullRequestCheckBadgeView
                        status={check.status}
                        conclusion={check.conclusion}
                      />
                    </a>
                  ))}
                </div>
              </section>
            )
          : null}

        <section>
          <PullRequestSectionHeadingView>
            {t('summary.comments')}
          </PullRequestSectionHeadingView>
          {detail.timeline.length > 0
            ? (
                <ol className="ml-2.5 border-l border-border/70">
                  {detail.timeline.map(item => (
                    <PullRequestTimelineEntryView
                      key={item.id}
                      item={item}
                      locale={locale}
                    />
                  ))}
                </ol>
              )
            : (
                <p className="text-[13px] text-muted-foreground/70">{t('timeline.empty')}</p>
              )}
          {actions
            ? (
                canAct
                  ? (
                      <div className="mt-4">
                        <PullRequestCommentComposerView
                          pending={actions.pending.comment}
                          onComment={actions.onComment}
                        />
                      </div>
                    )
                  : (
                      <p className="mt-3 text-[11px] text-muted-foreground">{t('console.closed')}</p>
                    )
              )
            : null}
        </section>
      </div>
    </div>
  )
}

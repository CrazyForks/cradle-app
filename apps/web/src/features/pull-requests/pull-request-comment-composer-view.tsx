import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'

export interface PullRequestCommentComposerViewProps {
  pending: boolean
  onComment: (body: string) => void
}

export function PullRequestCommentComposerView({
  pending,
  onComment,
}: PullRequestCommentComposerViewProps) {
  const { t } = useTranslation('pull-requests')
  const [body, setBody] = useState('')

  function submit() {
    const value = body.trim()
    if (!value) {
      return
    }
    onComment(value)
    setBody('')
  }

  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={body}
        onChange={event => setBody(event.target.value)}
        placeholder={t('console.comment.placeholder')}
        rows={2}
        className="min-h-12 flex-1 text-xs"
        disabled={pending}
      />
      <Button
        type="button"
        size="sm"
        className="h-8 shrink-0 text-xs"
        disabled={pending || body.trim().length === 0}
        onClick={submit}
      >
        {t('console.comment.submit')}
      </Button>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { getSessionsByIdWorkOptions } from '~/api-gen/@tanstack/react-query.gen'
import { RouteErrorFallback } from '~/components/common/route-error-fallback'
import { ChatSessionRouteContent } from '~/features/chat/session/chat-session-route-content'
import { openWork } from '~/navigation/navigation-commands'

export function resolvePrimaryWorkRedirect(
  sessionId: string,
  resolution: { work?: { id: string, primarySessionId: string } | null } | null | undefined,
): string | null {
  return resolution?.work?.primarySessionId === sessionId ? resolution.work.id : null
}

export const Route = createFileRoute('/chat/$sessionId')({
  errorComponent: RouteErrorFallback,
  component: ChatSessionRoute,
})

function ChatSessionRoute() {
  const { sessionId } = Route.useParams()
  const workQuery = useQuery(getSessionsByIdWorkOptions({ path: { id: sessionId } }))
  const redirectWorkId = resolvePrimaryWorkRedirect(sessionId, workQuery.data)

  useEffect(() => {
    if (redirectWorkId) {
      openWork(redirectWorkId, { replace: true })
    }
  }, [redirectWorkId])

  if (workQuery.error) {
    throw workQuery.error
  }
  if (!workQuery.data || redirectWorkId) {
    return null
  }
  return <ChatSessionRouteContent sessionId={sessionId} />
}

import type { InfiniteData } from '@tanstack/react-query'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { Stack } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  GetChatSessionsBySessionIdCapabilitiesResponse,
  GetChatSessionsBySessionIdMessagePreviewsResponse,
  GetChatSessionsBySessionIdMessagesByMessageIdResponse,
  GetChatSessionsBySessionIdRuntimeSettingsResponse,
  GetChatSessionsBySessionIdRuntimeStatusResponse,
  GetSessionsResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest, cradleStreamResponse } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import {
  readChatHistoryCache,
  writeChatHistoryCache,
} from './chat-history-cache'
import { consumeChatMessageStream } from './chat-stream'
import type { ChatSubmitInput } from './ChatComposer'
import { ChatView } from './ChatView'

export function ChatContainer({ sessionId }: { sessionId: string }) {
  const { connection } = useConnection()
  const activeStreamRef = useRef<AbortController | null>(null)
  const streamingMessageIdRef = useRef<string | null>(null)
  const [isLiveStreaming, setIsLiveStreaming] = useState(false)
  const [liveMessage, setLiveMessage] = useState<UIMessage | null>(null)
  const [pendingUser, setPendingUser] = useState<{ id: string | null, text: string } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [detailMessageId, setDetailMessageId] = useState<string | null>(null)
  const [cachedHistory, setCachedHistory] = useState<InfiniteData<GetChatSessionsBySessionIdMessagePreviewsResponse, string | null> | null>(null)
  const historyQueryKey = useMemo(
    () => ['chat-message-previews', connection?.url, sessionId] as const,
    [connection?.url, sessionId],
  )
  const sessionQuery = useQuery({
    enabled: Boolean(connection),
    queryKey: ['chat-session', connection?.url, sessionId],
    queryFn: () => cradleRequest<GetSessionsResponse[number]>(
      connection!,
      `/sessions/${encodeURIComponent(sessionId)}`,
    ),
    refetchOnMount: 'always',
  })
  const historyQuery = useInfiniteQuery({
    enabled: Boolean(connection),
    initialPageParam: null as string | null,
    queryKey: historyQueryKey,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
      return cradleRequest<GetChatSessionsBySessionIdMessagePreviewsResponse>(
        connection!,
        `/chat/sessions/${encodeURIComponent(sessionId)}/message-previews?limit=50${cursor}`,
      )
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    refetchOnMount: 'always',
  })
  const runtimeStatusQuery = useQuery({
    enabled: Boolean(connection),
    queryKey: ['chat-runtime-status', connection?.url, sessionId],
    queryFn: () => cradleRequest<GetChatSessionsBySessionIdRuntimeStatusResponse>(
      connection!,
      `/chat/sessions/${encodeURIComponent(sessionId)}/runtime-status`,
    ),
    refetchInterval: data => data.state.data?.status === 'idle' ? false : 5_000,
  })
  const capabilitiesQuery = useQuery({
    enabled: Boolean(connection),
    queryKey: ['chat-capabilities', connection?.url, sessionId],
    queryFn: () => cradleRequest<GetChatSessionsBySessionIdCapabilitiesResponse>(
      connection!,
      `/chat/sessions/${encodeURIComponent(sessionId)}/capabilities`,
    ),
  })
  const runtimeSettingsQuery = useQuery({
    enabled: Boolean(connection),
    queryKey: ['chat-runtime-settings', connection?.url, sessionId],
    queryFn: () => cradleRequest<GetChatSessionsBySessionIdRuntimeSettingsResponse>(
      connection!,
      `/chat/sessions/${encodeURIComponent(sessionId)}/runtime-settings`,
    ),
  })
  const detailQuery = useQuery({
    enabled: Boolean(connection && detailMessageId),
    queryKey: ['chat-message-detail', connection?.url, sessionId, detailMessageId],
    queryFn: () => cradleRequest<GetChatSessionsBySessionIdMessagesByMessageIdResponse>(
      connection!,
      `/chat/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(detailMessageId!)}`,
    ),
  })
  const refetchHistory = historyQuery.refetch
  const refetchRuntimeStatus = runtimeStatusQuery.refetch

  useEffect(() => {
    if (!connection) {
      setCachedHistory(null)
      return
    }
    let active = true
    void readChatHistoryCache(connection.url, sessionId).then((data) => {
      if (active) {
        setCachedHistory(data)
      }
    })
    return () => {
      active = false
    }
  }, [connection, sessionId])

  useEffect(() => {
    const queryHistoryData = historyQuery.data as InfiniteData<GetChatSessionsBySessionIdMessagePreviewsResponse, string | null> | undefined
    if (connection && queryHistoryData) {
      void writeChatHistoryCache(connection.url, sessionId, queryHistoryData)
    }
  }, [connection, historyQuery.data, sessionId])

  const queryHistoryData = historyQuery.data as InfiniteData<GetChatSessionsBySessionIdMessagePreviewsResponse, string | null> | undefined
  const historyData = queryHistoryData ?? cachedHistory
  const messages = [...(historyData?.pages ?? [])]
    .reverse()
    .flatMap(page => page.rows)
  const sessionStatus = runtimeStatusQuery.data?.status ?? sessionQuery.data?.status
  const streamingMessageId = messages
    .findLast(row => row.role === 'assistant' && row.status === 'streaming')
    ?.messageId ?? null
  streamingMessageIdRef.current = streamingMessageId

  useEffect(() => () => {
    activeStreamRef.current?.abort()
  }, [])

  useEffect(() => {
    if (
      !connection
      || sessionStatus !== 'streaming'
      || activeStreamRef.current
    ) {
      return
    }

    const controller = new AbortController()
    activeStreamRef.current = controller
    setIsLiveStreaming(true)
    setSendError(null)

    void cradleStreamResponse(
      connection,
      `/chat/sessions/${encodeURIComponent(sessionId)}/stream`,
      { signal: controller.signal },
    )
      .then(response => consumeChatMessageStream({
        messageId: streamingMessageIdRef.current ?? `assistant-${sessionId}`,
        onMessage: setLiveMessage,
        response,
      }))
      .catch((error: Error) => {
        if (!controller.signal.aborted) {
          setSendError(errorMessage(error))
        }
      })
      .finally(async () => {
        if (activeStreamRef.current !== controller) {
          return
        }
        activeStreamRef.current = null
        setIsLiveStreaming(false)
        const result = await refetchHistory()
        void refetchRuntimeStatus()
        if (result.isSuccess) {
          setLiveMessage(null)
        }
      })

    return () => {
      controller.abort()
      if (activeStreamRef.current === controller) {
        activeStreamRef.current = null
      }
      setIsLiveStreaming(false)
    }
  }, [connection, refetchHistory, refetchRuntimeStatus, sessionId, sessionStatus])

  const send = useMutation({
    mutationFn: async ({ files, text }: ChatSubmitInput) => {
      setSendError(null)
      const controller = new AbortController()
      activeStreamRef.current = controller
      setIsLiveStreaming(true)
      setLiveMessage(null)
      setPendingUser({ id: null, text })

      try {
        const response = await cradleStreamResponse(
          connection!,
          `/chat/sessions/${encodeURIComponent(sessionId)}/response`,
          {
            body: { files, text },
            method: 'POST',
            signal: controller.signal,
          },
        )
        const assistantMessageId = response.headers.get('x-cradle-assistant-message-id')
          ?? `assistant-${sessionId}`
        setPendingUser({
          id: response.headers.get('x-cradle-user-message-id'),
          text,
        })
        await consumeChatMessageStream({
          messageId: assistantMessageId,
          onMessage: setLiveMessage,
          response,
        })
      }
      finally {
        if (activeStreamRef.current === controller) {
          activeStreamRef.current = null
        }
        setIsLiveStreaming(false)
      }
    },
    onError: error => setSendError(errorMessage(error)),
    onSettled: async () => {
      const [result] = await Promise.all([
        refetchHistory(),
        refetchRuntimeStatus(),
      ])
      if (result.isSuccess) {
        setLiveMessage(null)
        setPendingUser(null)
      }
    },
  })

  const queue = useMutation({
    mutationFn: ({ files, text }: ChatSubmitInput) => cradleRequest(
      connection!,
      `/chat/sessions/${encodeURIComponent(sessionId)}/queue`,
      { method: 'POST', body: { files, text } },
    ),
    onError: error => setSendError(errorMessage(error)),
    onSuccess: () => {
      void refetchRuntimeStatus()
      void refetchHistory()
    },
  })

  const steer = useMutation({
    mutationFn: ({ files, text }: ChatSubmitInput) => cradleRequest(
      connection!,
      `/chat/sessions/${encodeURIComponent(sessionId)}/steer`,
      { method: 'POST', body: { files, text } },
    ),
    onError: error => setSendError(errorMessage(error)),
    onSuccess: () => {
      void refetchRuntimeStatus()
      void refetchHistory()
    },
  })

  const updateRuntimeSettings = useMutation({
    mutationFn: (interactionMode: 'default' | 'plan') => cradleRequest(
      connection!,
      `/chat/sessions/${encodeURIComponent(sessionId)}/runtime-settings`,
      { method: 'PATCH', body: { interactionMode } },
    ),
    onError: error => setSendError(errorMessage(error)),
    onSuccess: () => void runtimeSettingsQuery.refetch(),
  })

  const cancel = useMutation({
    mutationFn: () => cradleRequest(
      connection!,
      `/chat/sessions/${encodeURIComponent(sessionId)}/cancel`,
      { method: 'POST' },
    ),
    onSettled: () => {
      void refetchRuntimeStatus()
      void refetchHistory()
    },
  })

  const error = sessionQuery.error ?? (!historyData ? historyQuery.error : null)
  if (error) { return <ErrorState title="Could not open conversation" description={errorMessage(error)} /> }
  if (sessionQuery.isPending || (!historyData && historyQuery.isPending)) { return <LoadingState /> }
  if (!sessionQuery.data) { return <ErrorState title="Conversation not found" /> }
  const activeRun = runtimeStatusQuery.data?.activeRun ?? undefined
  const hasEarlier = Boolean(historyQuery.hasNextPage ?? historyData?.pages.at(-1)?.nextCursor)
  const isStreaming = isLiveStreaming
    || sessionStatus === 'streaming'
    || sessionStatus === 'waitingForUserInput'
    || sessionStatus === 'waitingForToolApproval'
  const queuedCount = runtimeStatusQuery.data?.queue.pending ?? 0
  return (
    <>
      <Stack.Screen options={{ title: sessionQuery.data.title ?? 'Conversation' }} />
      <ChatView
        activeRun={activeRun}
        isCancelling={cancel.isPending}
        capabilities={capabilitiesQuery.data}
        isSending={send.isPending || queue.isPending || steer.isPending}
        isStreaming={isStreaming}
        liveMessage={liveMessage}
        messages={messages}
        onCancel={() => cancel.mutate()}
        onModeChange={mode => updateRuntimeSettings.mutate(mode === 'plan' ? 'plan' : 'default')}
        onSend={(input) => {
          if (!isStreaming) {
            send.mutate(input)
          }
 else if (input.continuationMode === 'steer') {
            steer.mutate(input)
          }
 else {
            queue.mutate(input)
          }
        }}
        pendingUser={pendingUser}
        queuedCount={queuedCount}
        sendError={sendError}
        runtimeSettings={runtimeSettingsQuery.data}
        hasEarlier={hasEarlier}
        isLoadingEarlier={historyQuery.isFetchingNextPage}
        detailMessage={detailQuery.data?.message as UIMessage | undefined}
        detailMessageId={detailMessageId}
        isLoadingMessageDetail={detailQuery.isFetching}
        messageDetailError={detailQuery.error ? errorMessage(detailQuery.error) : null}
        onLoadEarlier={() => {
          if (hasEarlier && !historyQuery.isFetchingNextPage) {
            void historyQuery.fetchNextPage()
          }
        }}
        onRequestMessageDetail={setDetailMessageId}
      />
    </>
  )
}

import type {
  ChatGlobalSessionTailEvent,
  ChatSessionTailEvent,
  SyncClientSubFrame,
} from '@cradle/chat-runtime-contracts'

import {
  replayChatGlobalSessionTail,
  replayChatSessionTail,
  subscribeChatGlobalSessionTail,
  subscribeChatSessionTail,
} from '../chat-runtime/es/event-tail'
import type { SequencedRunChunk } from '../chat-runtime/stream/run-chunk-sequencer'
import {
  openSessionRunChunkSubscription,
} from '../chat-runtime/stream/session-run-chunk-sync'
import type { SyncSubscriptionSender } from './buffer'
import {
  SYNC_CHUNK_BUFFER_MAX,
  SYNC_CHUNK_BUFFER_MAX_BYTES,
  SYNC_TAIL_EVENT_BUFFER_MAX,
} from './buffer'

export function attachSyncSubscription(
  frame: SyncClientSubFrame,
  sender: SyncSubscriptionSender,
): () => void {
  switch (frame.channel) {
    case 'sessions-tail':
      return attachSessionsTail(frame, sender)
    case 'session-tail':
      return attachSessionTail(frame, sender)
    case 'run-chunks':
      return attachRunChunks(frame, sender)
    case 'workspace-files':
      sender.end('error', 'workspace-files channel is not implemented yet')
      return () => {}
    default:
      sender.end('error', 'Unknown sync channel')
      return () => {}
  }
}

function attachSessionsTail(
  frame: Extract<SyncClientSubFrame, { channel: 'sessions-tail' }>,
  sender: SyncSubscriptionSender,
): () => void {
  const workspaceId = frame.workspaceId?.trim() || null
  const replay = replayChatGlobalSessionTail({
    afterSequenceId: frame.afterSequenceId,
    workspaceId,
  })

  sendGlobalTailReplay(frame.subId, sender, replay.events, replay.snapshotRequired)
  sender.send({ subId: frame.subId, kind: 'sub-ack', channel: 'sessions-tail', cursor: replay.cursor })

  if (replay.snapshotRequired) {
    sender.end('snapshot-required')
    return () => {}
  }

  let liveSeq = replay.cursor
  return subscribeChatGlobalSessionTail(workspaceId, (event) => {
    if (event.sequenceId <= liveSeq) {
      return
    }
    liveSeq = event.sequenceId
    sender.send({ subId: frame.subId, kind: 'tail-event', event })
  })
}

function attachSessionTail(
  frame: Extract<SyncClientSubFrame, { channel: 'session-tail' }>,
  sender: SyncSubscriptionSender,
): () => void {
  const replay = replayChatSessionTail({
    sessionId: frame.sessionId,
    afterVersion: frame.afterVersion,
  })

  sendSessionTailReplay(frame.subId, sender, replay.events, replay.snapshotRequired)
  sender.send({ subId: frame.subId, kind: 'sub-ack', channel: 'session-tail', cursor: replay.cursor })

  if (replay.snapshotRequired) {
    sender.end('snapshot-required')
    return () => {}
  }

  let liveVersion = replay.cursor
  return subscribeChatSessionTail(frame.sessionId, (event) => {
    if (event.version <= liveVersion) {
      return
    }
    liveVersion = event.version
    sender.send({ subId: frame.subId, kind: 'tail-event', event })
  })
}

function attachRunChunks(
  frame: Extract<SyncClientSubFrame, { channel: 'run-chunks' }>,
  sender: SyncSubscriptionSender,
): () => void {
  let replaying = true
  const queuedLiveItems: SequencedRunChunk[] = []
  const sendLiveItem = (item: SequencedRunChunk) => {
    sender.send({
      subId: frame.subId,
      kind: 'chunk',
      runId: item.runId,
      cursor: item.cursor,
      chunk: item.chunk,
      terminal: item.terminal,
      replay: false,
    })
    if (item.terminal) {
      sender.send({
        subId: frame.subId,
        kind: 'sub-ack',
        channel: 'run-chunks',
        runId: item.runId,
        cursor: item.cursor,
      })
      sender.end('terminal')
    }
  }
  const subscription = openSessionRunChunkSubscription(frame.sessionId, frame.after, (item) => {
    if (replaying) {
      queuedLiveItems.push(item)
      return
    }
    sendLiveItem(item)
  })
  if (subscription.kind === 'not-found') {
    sender.end('not-found')
    return () => {}
  }
  sender.send({
    subId: frame.subId,
    kind: 'chunk',
    runId: subscription.runId,
    cursor: subscription.cursor,
    chunk: subscription.chunk,
    terminal: false,
    replay: true,
  })
  sender.send({
    subId: frame.subId,
    kind: 'sub-ack',
    channel: 'run-chunks',
    runId: subscription.runId,
    cursor: subscription.cursor,
  })
  replaying = false
  for (const item of queuedLiveItems) {
    if (item.cursor > subscription.cursor) {
      sendLiveItem(item)
    }
  }
  return subscription.unsubscribe
}

function sendSessionTailReplay(
  subId: string,
  sender: SyncSubscriptionSender,
  events: ChatSessionTailEvent[],
  snapshotRequired: ChatSessionTailEvent | null,
): void {
  for (const event of events) {
    sender.send({ subId, kind: 'tail-event', event })
  }
  if (snapshotRequired) {
    sender.send({ subId, kind: 'tail-event', event: snapshotRequired })
  }
}

function sendGlobalTailReplay(
  subId: string,
  sender: SyncSubscriptionSender,
  events: ChatGlobalSessionTailEvent[],
  snapshotRequired: ChatGlobalSessionTailEvent | null,
): void {
  for (const event of events) {
    sender.send({ subId, kind: 'tail-event', event })
  }
  if (snapshotRequired) {
    sender.send({ subId, kind: 'tail-event', event: snapshotRequired })
  }
}

export function readTailBufferLimits(): { maxFrames: number } {
  return { maxFrames: SYNC_TAIL_EVENT_BUFFER_MAX }
}

export function readChunkBufferLimits(): { maxFrames: number, maxBytes: number } {
  return {
    maxFrames: SYNC_CHUNK_BUFFER_MAX,
    maxBytes: SYNC_CHUNK_BUFFER_MAX_BYTES,
  }
}

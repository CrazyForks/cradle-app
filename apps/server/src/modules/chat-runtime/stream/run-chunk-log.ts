import type { UIMessageChunk } from 'ai'

import { readPositiveIntegerEnv } from '../../../helpers/env'
import { DEFAULT_RUN_REPLAY_CHUNKS } from './constants'

export interface SequencedRunChunk {
  runId: string
  cursor: number
  chunk: UIMessageChunk
  terminal: boolean
}

export type RunChunkReplay
  = | { kind: 'ready', runId: string, items: SequencedRunChunk[], cursor: number, live: boolean }
    | { kind: 'snapshot-required', runId: string, latestCursor: number }

export type SequencedRunChunkSubscriber = (entry: SequencedRunChunk) => void

export interface RunChunkLog {
  readonly runId: string
  append: (chunk: UIMessageChunk, terminal: boolean) => SequencedRunChunk
  replayAfter: (cursor?: number) => RunChunkReplay
  readLatestCursor: () => number
  readRetainedEntries: () => readonly SequencedRunChunk[]
  subscribe: (subscriber: SequencedRunChunkSubscriber) => () => void
  clear: () => void
}

export function createRunChunkLog(runId: string, capacity: number): RunChunkLog {
  const entries: SequencedRunChunk[] = []
  const subscribers = new Set<SequencedRunChunkSubscriber>()
  let nextCursor = 0
  let terminal = false

  return {
    runId,
    append(chunk, isTerminal) {
      if (terminal) {
        throw new Error(`Cannot append to terminal run chunk log ${runId}`)
      }
      const entry = { runId, cursor: nextCursor, chunk, terminal: isTerminal }
      nextCursor += 1
      terminal = isTerminal
      entries.push(entry)
      while (entries.length > capacity) {
        entries.shift()
      }
      for (const subscriber of [...subscribers]) {
        try {
          subscriber(entry)
        }
        catch {
          subscribers.delete(subscriber)
        }
      }
      if (isTerminal) {
        subscribers.clear()
      }
      return entry
    },
    replayAfter(cursor) {
      const latestCursor = nextCursor - 1
      const firstRetainedCursor = entries[0]?.cursor ?? nextCursor
      const requestedCursor = cursor ?? -1
      if (requestedCursor > latestCursor || requestedCursor < firstRetainedCursor - 1) {
        return { kind: 'snapshot-required', runId, latestCursor }
      }
      return {
        kind: 'ready',
        runId,
        items: entries.filter(entry => entry.cursor > requestedCursor),
        cursor: latestCursor,
        live: !terminal,
      }
    },
    readLatestCursor() {
      return nextCursor - 1
    },
    readRetainedEntries() {
      return entries.slice()
    },
    subscribe(subscriber) {
      if (!terminal) {
        subscribers.add(subscriber)
      }
      return () => subscribers.delete(subscriber)
    },
    clear() {
      entries.length = 0
      subscribers.clear()
    },
  }
}

export function createActiveRunChunkLog(runId: string): RunChunkLog {
  return createRunChunkLog(
    runId,
    readPositiveIntegerEnv('CRADLE_CHAT_RUN_REPLAY_CHUNKS', DEFAULT_RUN_REPLAY_CHUNKS),
  )
}

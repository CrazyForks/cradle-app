import type { UIMessageChunk } from 'ai'

import { readDeltaChunkTextLength } from '../run/stream-chunks'

export interface SequencedRunChunk {
  runId: string
  cursor: number
  chunk: UIMessageChunk
  terminal: boolean
}

export interface RunChunkPublicationSummary {
  latestCursor: number
  publishedChunkCount: number
  textDeltaCount: number
  reasoningDeltaCount: number
  toolInputDeltaCount: number
  toolOutputCount: number
  maxDeltaChars: number
}

export type SequencedRunChunkSubscriber = (entry: SequencedRunChunk) => void

export interface RunChunkSequencer {
  readonly runId: string
  publish: (chunk: UIMessageChunk, terminal: boolean) => SequencedRunChunk
  readLatestCursor: () => number
  readPublicationSummary: () => RunChunkPublicationSummary
  subscribe: (subscriber: SequencedRunChunkSubscriber) => () => void
  clear: () => void
}

export function createRunChunkSequencer(runId: string): RunChunkSequencer {
  const subscribers = new Set<SequencedRunChunkSubscriber>()
  let nextCursor = 0
  let terminal = false
  let publishedChunkCount = 0
  let textDeltaCount = 0
  let reasoningDeltaCount = 0
  let toolInputDeltaCount = 0
  let toolOutputCount = 0
  let maxDeltaChars = 0

  return {
    runId,
    publish(chunk, isTerminal) {
      if (terminal) {
        throw new Error(`Cannot publish to terminal run chunk sequencer ${runId}`)
      }

      const entry: SequencedRunChunk = {
        runId,
        cursor: nextCursor,
        chunk,
        terminal: isTerminal,
      }
      nextCursor += 1
      terminal = isTerminal
      publishedChunkCount += 1
      maxDeltaChars = Math.max(maxDeltaChars, readDeltaChunkTextLength(chunk))

      switch (chunk.type) {
        case 'text-delta':
          textDeltaCount += 1
          break
        case 'reasoning-delta':
          reasoningDeltaCount += 1
          break
        case 'tool-input-delta':
          toolInputDeltaCount += 1
          break
        case 'tool-output-available':
          toolOutputCount += 1
          break
      }

      for (const subscriber of subscribers) {
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
    readLatestCursor() {
      return nextCursor - 1
    },
    readPublicationSummary() {
      return {
        latestCursor: nextCursor - 1,
        publishedChunkCount,
        textDeltaCount,
        reasoningDeltaCount,
        toolInputDeltaCount,
        toolOutputCount,
        maxDeltaChars,
      }
    },
    subscribe(subscriber) {
      if (!terminal) {
        subscribers.add(subscriber)
      }
      return () => subscribers.delete(subscriber)
    },
    clear() {
      subscribers.clear()
    },
  }
}

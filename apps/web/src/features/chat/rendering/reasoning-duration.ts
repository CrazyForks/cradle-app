/**
 * Tracks wall-clock reasoning durations for live streams. Keyed by part object
 * identity so the render path stays free of extra stores: the bridge layer must
 * pass a stable object per reasoning part (the raw store part or a ref-cached
 * projection). Historical parts never seen streaming resolve to `undefined`,
 * which the activity feed renders as "Thought briefly".
 */

interface ReasoningDurationRecord {
  start: number
  end?: number
}

const durationRecords = new WeakMap<object, ReasoningDurationRecord>()

export function readReasoningDurationMs(part: {
  text: string
  state?: 'streaming' | 'done'
}): number | undefined {
  if (typeof part !== 'object' || part === null) {
    return undefined
  }

  let record = durationRecords.get(part)
  if (part.state === 'streaming') {
    if (!record) {
      record = { start: Date.now() }
      durationRecords.set(part, record)
    }
    return undefined
  }

  if (part.state === 'done' && record) {
    if (record.end === undefined) {
      record.end = Date.now()
    }
    return record.end - record.start
  }

  return undefined
}

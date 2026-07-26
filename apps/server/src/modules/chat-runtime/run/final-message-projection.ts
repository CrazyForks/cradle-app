import {
  applyUIMessageChunk,
  createUIMessageStreamState,
  finalizeUIMessageStreamState,
  flushUIMessageStreamState,
  flushUIMessageStreamToolInputs,
} from '@cradleapp/ai-sdk'
import type { UIMessage, UIMessageChunk } from 'ai'

export type FinalMessageProjectionState = ReturnType<typeof createUIMessageStreamState>

export interface FinalMessageProjectionRun {
  finalMessage: UIMessage
  finalProjection: FinalMessageProjectionState
}

export function createFinalMessageProjectionState(): FinalMessageProjectionState {
  return createUIMessageStreamState()
}

export function projectFinalMessageChunk(
  activeRun: FinalMessageProjectionRun,
  chunk: UIMessageChunk,
): void {
  const target = toTarget(activeRun)
  applyUIMessageChunk(target, chunk)
  activeRun.finalMessage = target.message
  activeRun.finalProjection = target.state
}

export function flushFinalMessageProjection(activeRun: FinalMessageProjectionRun): void {
  flushUIMessageStreamState(toTarget(activeRun))
}

export function finalizeFinalMessageProjection(activeRun: FinalMessageProjectionRun): void {
  finalizeUIMessageStreamState(toTarget(activeRun))
}

export async function flushProjectedToolInputs(activeRun: FinalMessageProjectionRun): Promise<void> {
  await flushUIMessageStreamToolInputs(toTarget(activeRun))
}

function toTarget(activeRun: FinalMessageProjectionRun) {
  return {
    message: activeRun.finalMessage,
    state: activeRun.finalProjection,
  }
}

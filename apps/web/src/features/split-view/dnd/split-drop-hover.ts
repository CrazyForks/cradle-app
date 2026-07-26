import { useSyncExternalStore } from 'react'

import type { SplitDirection } from '../model/split-direction'

export interface SplitDropBounds {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Shared drop feedback for every split drag source — sidebar items (HTML5
 * drag) and surface tabs (pointer drag) publish into the same state, so the
 * overlay the user sees always describes the drop that will actually happen.
 *
 * Kept outside React state: hover updates fire on every pointer move, and this
 * way only the single overlay component re-renders.
 */
export interface SplitDropHover {
  surfaceId: string
  direction: SplitDirection
  /** Viewport rect of the pane group being dropped into. */
  bounds: SplitDropBounds
}

let hover: SplitDropHover | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function sameHover(left: SplitDropHover | null, right: SplitDropHover | null): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return left.surfaceId === right.surfaceId
    && left.direction === right.direction
    && left.bounds.left === right.bounds.left
    && left.bounds.top === right.bounds.top
    && left.bounds.width === right.bounds.width
    && left.bounds.height === right.bounds.height
}

export function setSplitDropHover(next: SplitDropHover | null): void {
  if (sameHover(hover, next)) {
    return
  }
  hover = next
  emit()
}

export function clearSplitDropHover(surfaceId?: string): void {
  if (!hover || (surfaceId && hover.surfaceId !== surfaceId)) {
    return
  }
  hover = null
  emit()
}

export function getSplitDropHover(): SplitDropHover | null {
  return hover
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): SplitDropHover | null {
  return hover
}

function getServerSnapshot(): SplitDropHover | null {
  return null
}

export function useSplitDropHover(surfaceId: string): SplitDropHover | null {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return current?.surfaceId === surfaceId ? current : null
}

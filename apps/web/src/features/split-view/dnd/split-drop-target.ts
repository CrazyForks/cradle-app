import type { DockviewGroupPanel } from 'dockview-react'

import type { SurfaceRoute } from '~/navigation/surface-identity'
import { surfaceIdForRoute } from '~/navigation/surface-identity'

import type { SplitDirection } from '../model/split-direction'
import { boundsFromRect, directionFromPoint } from '../model/split-direction'
import { findSplitGroupAtPoint } from '../runtime/split-dockview-registry'
import { readSplitWorkspace } from '../store/split-workspace-store'
import type { SplitDropBounds } from './split-drop-hover'
import { clearSplitDropHover, setSplitDropHover } from './split-drop-hover'

/** Marks the split host container, for hit-testing a surface under the pointer. */
export const SPLIT_SURFACE_ATTRIBUTE = 'data-split-surface-id'

export interface SplitDropTarget {
  surfaceId: string
  direction: SplitDirection
  bounds: SplitDropBounds
  /** Pane group the drop is relative to, when the surface is already split. */
  referenceGroup?: DockviewGroupPanel
}

export interface SplitDropPoint {
  clientX: number
  clientY: number
  /** Route being dragged. A route cannot be dropped into itself. */
  route: SurfaceRoute
}

/**
 * Walk the hit-test stack rather than taking the topmost node: a drag ghost or
 * overlay may still be hit-testable in some hosts and would otherwise mask the
 * surface underneath the cursor.
 */
function splitSurfaceElementFromPoint(clientX: number, clientY: number): HTMLElement | null {
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    if (!(node instanceof Element)) {
      continue
    }
    const surface = node.closest<HTMLElement>(`[${SPLIT_SURFACE_ATTRIBUTE}]`)
    if (surface) {
      return surface
    }
  }
  return null
}

/**
 * Resolve the surface and pane group under the pointer plus the edge that
 * would be split. Shared by hover feedback and the drop itself, so the overlay
 * can never promise a placement the drop would not perform.
 */
export function resolveSplitDropTarget(point: SplitDropPoint): SplitDropTarget | null {
  const element = splitSurfaceElementFromPoint(point.clientX, point.clientY)
  const surfaceId = element?.dataset.splitSurfaceId
  if (!element || !surfaceId) {
    return null
  }

  // Already on screen in this surface: dropping it again would be a no-op, so
  // do not offer a target at all.
  if (readSplitWorkspace(surfaceId)?.panes[surfaceIdForRoute(point.route)]) {
    return null
  }

  const referenceGroup = findSplitGroupAtPoint(surfaceId, point.clientX, point.clientY)
  const rect = referenceGroup?.element.getBoundingClientRect() ?? element.getBoundingClientRect()

  return {
    surfaceId,
    direction: directionFromPoint(rect, point),
    bounds: boundsFromRect(rect),
    referenceGroup,
  }
}

/** Publish (or clear) drop feedback for a pointer sample. */
export function updateSplitDropHover(point: SplitDropPoint | null): void {
  const target = point ? resolveSplitDropTarget(point) : null
  if (!target) {
    clearSplitDropHover()
    return
  }
  setSplitDropHover({
    surfaceId: target.surfaceId,
    direction: target.direction,
    bounds: target.bounds,
  })
}

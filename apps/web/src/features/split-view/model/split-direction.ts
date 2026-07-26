/**
 * Directions a pane can be split in. Structurally identical to dockview's
 * `Direction`, restated here so the store, drag sources and commands can talk
 * about placement without importing the rendering layer.
 */
export type SplitDirection = 'left' | 'right' | 'above' | 'below'

export interface SplitBounds {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Resolve a pointer position into a split direction by cutting the target box
 * along its diagonals into four triangles. This covers the whole area with no
 * dead centre zone, so releasing in the middle of a pane — where people
 * naturally aim when dragging something "into" a view — still splits it
 * instead of silently doing nothing.
 */
export function directionFromPoint(
  bounds: SplitBounds,
  point: { clientX: number, clientY: number },
): SplitDirection {
  const dx = (point.clientX - bounds.left) / Math.max(bounds.width, 1) - 0.5
  const dy = (point.clientY - bounds.top) / Math.max(bounds.height, 1) - 0.5

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left'
  }
  return dy > 0 ? 'below' : 'above'
}

export function boundsFromRect(rect: DOMRectReadOnly | DOMRect): SplitBounds {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

import type { SurfaceRoute } from '~/navigation/surface-identity'

const SURFACE_DRAG_EVENT = 'cradle:surface-drag'

export interface SurfaceDragSample {
  clientX: number | null
  clientY: number | null
  /** Route of the tab being dragged, or `null` once the drag ends. */
  route: SurfaceRoute | null
}

/**
 * Pointer stream for surface-bar tab drags.
 *
 * Tabs are dragged with a pointer sensor rather than HTML5 drag-and-drop (they
 * can be torn off into native windows), so dockview never sees those events.
 * This is not a second split system: the samples only feed hit-testing and the
 * shared hover state, and the release goes through the same command as every
 * other drop.
 */
export function publishSurfaceDrag(sample: SurfaceDragSample): void {
  window.dispatchEvent(new CustomEvent<SurfaceDragSample>(SURFACE_DRAG_EVENT, { detail: sample }))
}

export function subscribeSurfaceDrag(listener: (sample: SurfaceDragSample) => void): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<SurfaceDragSample>).detail)
  }
  window.addEventListener(SURFACE_DRAG_EVENT, handleEvent)
  return () => window.removeEventListener(SURFACE_DRAG_EVENT, handleEvent)
}

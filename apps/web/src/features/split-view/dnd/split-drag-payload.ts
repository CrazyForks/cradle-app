import { SESSION_DRAG_MIME_TYPE } from '~/features/workspace/session-drag-data'
import type { SurfaceRoute } from '~/navigation/surface-identity'
import { parseSurfaceRoute } from '~/navigation/surface-identity'

/**
 * One drag payload for the whole app: whatever can be shown as a surface can
 * be dragged into a split pane, so the transferred value is the route itself
 * rather than a domain id.
 */
export const SURFACE_ROUTE_MIME_TYPE = 'application/x-cradle-surface-route'

export function writeSurfaceRouteDrag(dataTransfer: DataTransfer, route: SurfaceRoute): void {
  dataTransfer.setData(SURFACE_ROUTE_MIME_TYPE, JSON.stringify(route))
}

export function hasSurfaceRouteDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false
  }
  const types = Array.from(dataTransfer.types)
  return types.includes(SURFACE_ROUTE_MIME_TYPE) || types.includes(SESSION_DRAG_MIME_TYPE)
}

export function readSurfaceRouteDrag(dataTransfer: DataTransfer | null): SurfaceRoute | null {
  if (!dataTransfer) {
    return null
  }

  const raw = dataTransfer.getData(SURFACE_ROUTE_MIME_TYPE)
  if (raw) {
    try {
      return parseSurfaceRoute(JSON.parse(raw))
    }
    catch {
      return null
    }
  }

  const sessionId = dataTransfer.getData(SESSION_DRAG_MIME_TYPE)
  return sessionId ? { to: '/chat/$sessionId', params: { sessionId } } : null
}

export function readDraggedSessionId(dataTransfer: DataTransfer | null): string | null {
  const route = readSurfaceRouteDrag(dataTransfer)
  return route?.to === '/chat/$sessionId' ? route.params.sessionId : null
}

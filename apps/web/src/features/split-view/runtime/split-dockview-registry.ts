import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'

/**
 * Transient (never persisted) registry of live `DockviewApi` instances keyed
 * by surface id. Lets code outside the dockview component tree — global
 * keyboard commands, the surface bar's tab-drop path — command a specific
 * split workspace without threading the api through props.
 */
const registry = new Map<string, DockviewApi>()

export function registerSplitDockviewApi(surfaceId: string, api: DockviewApi): () => void {
  registry.set(surfaceId, api)
  return () => {
    if (registry.get(surfaceId) === api) {
      registry.delete(surfaceId)
    }
  }
}

export function getSplitDockviewApi(surfaceId: string): DockviewApi | undefined {
  return registry.get(surfaceId)
}

/**
 * Group under the pointer, for drag sources that are not HTML5 drags (dockview
 * resolves those itself). Falls back to the active group so a release over
 * chrome that belongs to the surface still lands somewhere sensible.
 */
export function findSplitGroupAtPoint(
  surfaceId: string,
  clientX: number,
  clientY: number,
): DockviewGroupPanel | undefined {
  const api = registry.get(surfaceId)
  if (!api) {
    return undefined
  }

  for (const group of api.groups) {
    const rect = group.element.getBoundingClientRect()
    if (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    ) {
      return group
    }
  }

  return api.activeGroup ?? api.groups[0]
}

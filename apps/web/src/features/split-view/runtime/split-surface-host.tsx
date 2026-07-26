import type {
  DockviewApi,
  DockviewDidDropEvent,
  DockviewDndOverlayEvent,
  DockviewReadyEvent,
} from 'dockview-react'
import { DockviewReact, positionToDirection } from 'dockview-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { SurfaceRoute } from '~/navigation/surface-identity'
import { surfaceIdForRoute } from '~/navigation/surface-identity'

import { hasSurfaceRouteDrag, readSurfaceRouteDrag } from '../dnd/split-drag-payload'
import { clearSplitDropHover, useSplitDropHover } from '../dnd/split-drop-hover'
import { SplitDropOverlay } from '../dnd/split-drop-overlay'
import { SPLIT_SURFACE_ATTRIBUTE, updateSplitDropHover } from '../dnd/split-drop-target'
import { subscribeSurfaceDrag } from '../dnd/surface-drag-stream'
import { openRouteInSplit } from '../split-commands'
import { themeCradle } from '../split-view-theme'
import { readSplitWorkspace, useSplitWorkspaceStore } from '../store/split-workspace-store'
import { registerSplitDockviewApi } from './split-dockview-registry'
import { SPLIT_PANE_COMPONENT, SplitPaneContent } from './split-pane-content'
import { SplitPaneHostProvider } from './split-pane-host-context'
import { addSplitPanel, lockGroupsToSplitOnly } from './split-panels'

const dockviewComponents = { [SPLIT_PANE_COMPONENT]: SplitPaneContent }

/**
 * Layout writes are coalesced: dockview reports a layout change on every frame
 * of a sash drag, and each one would otherwise serialize the grid and hit
 * persisted storage. Nothing reads the layout back until the surface is
 * remounted, so a trailing write is enough.
 */
const LAYOUT_PERSIST_DEBOUNCE_MS = 300

function isSurfaceRouteDragOverlay(event: DockviewDndOverlayEvent): boolean {
  return event.nativeEvent instanceof DragEvent && hasSurfaceRouteDrag(event.nativeEvent.dataTransfer)
}

/**
 * Split host for a surface (top-level tab). Every surface renders through it,
 * so any interface in the app can be split against any other — the primary
 * pane is the window's routed content, the rest are routes opened beside it.
 *
 * Mounting dockview unconditionally (rather than swapping a plain view for a
 * dock once a second pane appears) means the first split does not remount the
 * content that was already on screen, and leaves exactly one drag-and-drop
 * implementation to reason about.
 */
export function SplitSurfaceHost({
  surfaceId,
  route,
  children,
}: {
  surfaceId: string
  route: SurfaceRoute
  children: ReactNode
}) {
  const primaryPaneId = surfaceIdForRoute(route)
  const ensureWorkspace = useSplitWorkspaceStore(state => state.ensureWorkspace)
  const setLayout = useSplitWorkspaceStore(state => state.setLayout)
  const forgetPane = useSplitWorkspaceStore(state => state.forgetPane)
  const focusPane = useSplitWorkspaceStore(state => state.focusPane)
  const hover = useSplitDropHover(surfaceId)

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistLayoutRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    ensureWorkspace(surfaceId, route)
  }, [ensureWorkspace, route, surfaceId])

  // Surface-bar tab drags are pointer-driven, so dockview never sees them.
  // One subscriber per mounted host is enough: hit resolution is global.
  useEffect(() => {
    return subscribeSurfaceDrag((sample) => {
      updateSplitDropHover(
        sample.route && sample.clientX !== null && sample.clientY !== null
          ? { clientX: sample.clientX, clientY: sample.clientY, route: sample.route }
          : null,
      )
    })
  }, [])

  useEffect(() => {
    return () => {
      clearSplitDropHover(surfaceId)
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
        // Flush the pending layout so a tab switch mid-drag is not lost.
        persistLayoutRef.current?.()
      }
    }
  }, [surfaceId])

  const handleReady = useCallback((event: DockviewReadyEvent) => {
    const { api } = event

    persistLayoutRef.current = () => setLayout(surfaceId, api.toJSON())
    const schedulePersist = () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current)
      }
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null
        persistLayoutRef.current?.()
      }, LAYOUT_PERSIST_DEBOUNCE_MS)
    }

    restoreLayout(api, surfaceId, primaryPaneId)

    api.onDidLayoutChange(schedulePersist)
    api.onDidRemovePanel(panel => forgetPane(surfaceId, panel.id))
    api.onDidActivePanelChange((active) => {
      if (active.panel) {
        focusPane(surfaceId, active.panel.id)
      }
    })

    api.onUnhandledDragOver((dragEvent) => {
      if (isSurfaceRouteDragOverlay(dragEvent)) {
        dragEvent.accept()
      }
    })

    api.onDidDrop((dropEvent: DockviewDidDropEvent) => {
      if (!(dropEvent.nativeEvent instanceof DragEvent)) {
        return
      }
      const droppedRoute = readSurfaceRouteDrag(dropEvent.nativeEvent.dataTransfer)
      const direction = positionToDirection(dropEvent.position)
      if (!droppedRoute || direction === 'within') {
        return
      }
      openRouteInSplit(surfaceId, { route: droppedRoute, direction, referenceGroup: dropEvent.group })
    })

    return registerSplitDockviewApi(surfaceId, api)
  }, [focusPane, forgetPane, primaryPaneId, setLayout, surfaceId])

  const hostValue = useMemo(
    () => ({ surfaceId, primaryPaneId, primaryContent: children }),
    [children, primaryPaneId, surfaceId],
  )

  return (
    <SplitPaneHostProvider value={hostValue}>
      <div
        {...{ [SPLIT_SURFACE_ATTRIBUTE]: surfaceId }}
        className="relative h-full min-h-0 w-full min-w-0"
      >
        <DockviewReact
          key={surfaceId}
          className="dockview-theme-cradle h-full w-full"
          theme={themeCradle}
          components={dockviewComponents}
          onReady={handleReady}
          noPanelsOverlay="emptyGroup"
        />
        {hover && <SplitDropOverlay hover={hover} />}
      </div>
    </SplitPaneHostProvider>
  )
}

/**
 * Rebuild the dock from persisted state, falling back to a single primary pane
 * whenever the stored grid no longer matches the panes this workspace knows
 * about — a partially restored layout is worse than a clean one.
 */
function restoreLayout(api: DockviewApi, surfaceId: string, primaryPaneId: string): void {
  const workspace = readSplitWorkspace(surfaceId)
  const paneIds = workspace ? Object.keys(workspace.panes) : [primaryPaneId]

  let restored = false
  if (workspace?.layout && paneIds.length > 1) {
    try {
      api.fromJSON(workspace.layout)
      restored = api.panels.length === paneIds.length
        && api.panels.every(panel => paneIds.includes(panel.id))
        && api.groups.every(group => group.panels.length === 1)
    }
    catch {
      restored = false
    }
    if (!restored) {
      api.clear()
    }
  }

  if (!restored) {
    for (const paneId of [primaryPaneId, ...paneIds.filter(id => id !== primaryPaneId)]) {
      addSplitPanel(api, paneId, 'right')
    }
  }

  lockGroupsToSplitOnly(api)
}

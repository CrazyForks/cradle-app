import type { ReactNode } from 'react'

import type { SurfaceRoute } from '~/navigation/surface-identity'

import { useIsSplitPaneRoot } from './runtime/split-pane-root-context'
import { SplitSurfaceHost } from './runtime/split-surface-host'

/**
 * Public entry to the universal split view. Wraps a surface's routed content
 * so any interface in the app can be split against any other, all through one
 * engine instead of a per-feature implementation.
 *
 * Inside a secondary pane the app's route tree runs again, which re-enters this
 * component. A pane must not host its own nested split (dockview inside
 * dockview), so when already within a pane it renders the content plainly.
 */
export function SplitSurface({
  surfaceId,
  route,
  children,
}: {
  surfaceId: string
  route: SurfaceRoute
  children: ReactNode
}) {
  const isPaneRoot = useIsSplitPaneRoot()
  if (isPaneRoot) {
    return <>{children}</>
  }
  return (
    <SplitSurfaceHost surfaceId={surfaceId} route={route}>
      {children}
    </SplitSurfaceHost>
  )
}

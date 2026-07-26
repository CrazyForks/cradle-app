import { createMemoryHistory, createRouter, RouterProvider, useRouter } from '@tanstack/react-router'
import { useMemo } from 'react'

import { RouteErrorFallback } from '~/components/common/route-error-fallback'
import type { SurfaceRoute } from '~/navigation/surface-identity'
import { routeTree } from '~/routeTree.gen'

import { SplitPaneRootProvider } from './split-pane-root-context'

/**
 * Renders a secondary split pane by running the application's own route tree
 * against a private in-memory location.
 *
 * The alternative — a hand-written map from route to page component — would be
 * a second, silently diverging copy of the router: no loaders, no error
 * components, no pending states, and a new maintenance burden every time a
 * route is added. Here a pane gets all of that for free, and navigating inside
 * a pane (following a link, switching a tab within a page) stays contained to
 * that pane instead of moving the window's URL.
 */
export function SplitPaneRouter({ route }: { route: SurfaceRoute }) {
  const hostRouter = useRouter()
  // Reading the href off the host router keeps path building in one place and
  // avoids importing the router singleton (which owns this module's route
  // tree) back into the pane runtime.
  const href = hostRouter.buildLocation(route as Parameters<typeof hostRouter.buildLocation>[0]).href

  const paneRouter = useMemo(
    () =>
      createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: [href] }),
        defaultErrorComponent: RouteErrorFallback,
        defaultPendingComponent: () => null,
        // Panes are already-decided destinations; hover preloading inside one
        // would warm routes the user cannot navigate the window to anyway.
        defaultPreload: false,
      }),
    [href],
  )

  return (
    <SplitPaneRootProvider value={true}>
      <RouterProvider router={paneRouter} />
    </SplitPaneRootProvider>
  )
}

import { createRootRoute, Outlet } from '@tanstack/react-router'

import { AppRouteRoot } from '~/app-shell'
import { useIsSplitPaneRoot } from '~/features/split-view/runtime/split-pane-root-context'

export const Route = createRootRoute({
  component: RootRoute,
})

function RootRoute() {
  // A secondary split pane runs the app's own route tree against a private
  // location, which re-enters the root component. The pane is a single view,
  // not a whole window, so it must render only the routed outlet — never a
  // second app shell (sidebar, surface bar, global dialogs).
  const isPaneRoot = useIsSplitPaneRoot()
  return isPaneRoot ? <Outlet /> : <AppRouteRoot />
}

import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'

import type { SplitDirection } from '../model/split-direction'
import type { SplitPaneParams } from './split-pane-content'
import { SPLIT_PANE_COMPONENT } from './split-pane-content'

/**
 * A locked group still accepts edge drops that create a split, but rejects
 * centre drops that would stack another pane as a hidden tab. Panes are
 * side-by-side views of the app; a pane the user cannot see is not one.
 */
export function lockGroupsToSplitOnly(api: DockviewApi): void {
  for (const group of api.groups) {
    group.api.locked = true
  }
}

/**
 * Add a pane's panel to a live dockview. The pane must already exist in the
 * store — the panel component resolves its route from there.
 */
export function addSplitPanel(
  api: DockviewApi,
  paneId: string,
  direction: SplitDirection,
  referenceGroup?: DockviewGroupPanel,
): boolean {
  const existing = api.getPanel(paneId)
  if (existing) {
    existing.api.setActive()
    return false
  }

  const params: SplitPaneParams = { paneId }
  api.addPanel({
    id: paneId,
    component: SPLIT_PANE_COMPONENT,
    // Tabs are hidden by the theme; the title only surfaces in dockview's own
    // internals, so the pane id is the most useful thing to put there.
    title: paneId,
    params,
    position: referenceGroup ? { direction, referenceGroup } : { direction },
  })
  lockGroupsToSplitOnly(api)
  return true
}

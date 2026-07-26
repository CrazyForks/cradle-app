import 'dockview-react/dist/styles/dockview.css'
import './split-view-theme.css'

import type { DockviewTheme } from 'dockview-react'

/**
 * dockview theme backed entirely by Cradle's own design tokens (see
 * split-view-theme.css). Colors are not baked in here — they live in CSS
 * custom properties that already respond to light/dark mode.
 */
export const themeCradle: DockviewTheme = {
  name: 'cradle',
  className: 'dockview-theme-cradle',
  gap: 4,
  dndOverlayMounting: 'relative',
  dndPanelOverlay: 'content',
  dndTabIndicator: 'fill',
  tabGroupIndicator: 'none',
}

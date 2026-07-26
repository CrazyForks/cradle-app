import type { CSSProperties } from 'react'

import type { SplitDirection } from '../model/split-direction'
import type { SplitDropHover } from './split-drop-hover'

/**
 * Geometry of the sliding drop fill — the same half-pane quadrants dockview
 * uses, expressed as percentages so CSS animates top/left/width/height between
 * directions instead of swapping discrete class names.
 */
function fillStyleForDirection(direction: SplitDirection): CSSProperties {
  switch (direction) {
    case 'left':
      return { top: 0, left: 0, width: '50%', height: '100%' }
    case 'right':
      return { top: 0, left: '50%', width: '50%', height: '100%' }
    case 'above':
      return { top: 0, left: 0, width: '100%', height: '50%' }
    case 'below':
      return { top: '50%', left: 0, width: '100%', height: '50%' }
  }
}

/**
 * Drop feedback for pointer-driven (non-HTML5) split drags. HTML5 drags get
 * dockview's own overlay; this mirrors its geometry and easing so both paths
 * read as the same system.
 */
export function SplitDropOverlay({ hover }: { hover: SplitDropHover }) {
  return (
    <div
      aria-hidden="true"
      className="split-drop-indicator-host dockview-theme-cradle"
      style={{
        left: hover.bounds.left,
        top: hover.bounds.top,
        width: hover.bounds.width,
        height: hover.bounds.height,
      }}
    >
      <div className="split-drop-indicator" style={fillStyleForDirection(hover.direction)} />
    </div>
  )
}

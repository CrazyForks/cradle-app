import type { ReactNode } from 'react'
import { createContext, use } from 'react'

export interface SplitPaneHostValue {
  surfaceId: string
  /** Pane bound to the surface's route; it renders the window's outlet. */
  primaryPaneId: string
  /**
   * The router outlet. Passed through context rather than dockview panel
   * params because params are serialized into the persisted layout and must
   * stay plain JSON.
   */
  primaryContent: ReactNode
}

const SplitPaneHostContext = createContext<SplitPaneHostValue | null>(null)

export const SplitPaneHostProvider = SplitPaneHostContext.Provider

export function useSplitPaneHost(): SplitPaneHostValue | null {
  return use(SplitPaneHostContext)
}

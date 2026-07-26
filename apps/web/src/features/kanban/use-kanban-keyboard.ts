import { useEffect, useRef } from 'react'

import type { KanbanBoardIssue } from '~/features/kanban/types'

export interface KanbanKeyboardActions {
  /** Issues in rendered order; the source of truth for focus movement. */
  visibleIssues: KanbanBoardIssue[]
  focusedIndex: number
  hoveredIssueId: string | null
  selectedCount: number
  /** True while the issue detail owns the surface — board shortcuts stand down. */
  detailOpen: boolean
  setFocusedIndex: (index: number) => void
  openIssue: (issueId: string) => void
  toggleSelection: (issueId: string) => void
  extendSelection: (issueId: string) => void
  selectAll: () => void
  clearSelection: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) {
    return false
  }
  return (
    element.tagName === 'INPUT'
    || element.tagName === 'TEXTAREA'
    || element.tagName === 'SELECT'
    || element.isContentEditable
    || Boolean(
      element.closest(
        '[data-slot="dialog-content"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="context-menu-content"]',
      ),
    )
  )
}

/**
 * Board keyboard model.
 *
 * Deliberately small and predictable: move focus, open, select. The previous handler
 * also owned a space-to-peek gesture with a 300 ms hold timer and a hover-follow
 * side channel, which made the same key mean different things depending on timing.
 *
 * - `j` / `k` / arrows — move focus
 * - `Shift` + move — extend selection
 * - `Enter` / `Space` — open the focused issue
 * - `x` — toggle selection, `Shift+x` extends
 * - `Cmd/Ctrl+a` — select all visible
 * - `Escape` — clear selection
 */
export function useKanbanKeyboard(actions: KanbanKeyboardActions) {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const current = actionsRef.current
      if (current.detailOpen || isTypingTarget(event.target)) {
        return
      }

      const issues = current.visibleIssues
      if (issues.length === 0) {
        return
      }

      const modified = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (modified && !event.altKey && key === 'a') {
        event.preventDefault()
        current.selectAll()
        return
      }

      if (modified || event.altKey) {
        return
      }

      // Focus falls back to hover, then to the first issue, so a shortcut always
      // has a subject even before the user has moved focus explicitly.
      const resolveIndex = () => {
        if (current.focusedIndex >= 0 && current.focusedIndex < issues.length) {
          return current.focusedIndex
        }
        if (current.hoveredIssueId) {
          const hoveredIndex = issues.findIndex(issue => issue.id === current.hoveredIssueId)
          if (hoveredIndex >= 0) {
            return hoveredIndex
          }
        }
        return 0
      }

      if (event.key === 'Escape') {
        if (current.selectedCount > 0) {
          event.preventDefault()
          current.clearSelection()
        }
        return
      }

      const isDown = event.key === 'ArrowDown' || key === 'j'
      const isUp = event.key === 'ArrowUp' || key === 'k'

      if (isDown || isUp) {
        event.preventDefault()
        const startIndex = resolveIndex()
        const nextIndex = isDown
          ? Math.min(startIndex + 1, issues.length - 1)
          : Math.max(startIndex - 1, 0)
        current.setFocusedIndex(nextIndex)

        const nextIssueId = issues[nextIndex]?.id
        if (event.shiftKey && nextIssueId) {
          if (current.selectedCount === 0) {
            current.toggleSelection(issues[startIndex]?.id ?? nextIssueId)
          }
          current.extendSelection(nextIssueId)
        }
        return
      }

      if (key === 'x') {
        event.preventDefault()
        const issueId = issues[resolveIndex()]?.id
        if (!issueId) {
          return
        }
        current.setFocusedIndex(resolveIndex())
        if (event.shiftKey) {
          current.extendSelection(issueId)
          return
        }
        current.toggleSelection(issueId)
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const issueId = issues[resolveIndex()]?.id
        if (issueId) {
          current.openIssue(issueId)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}

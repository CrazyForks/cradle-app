export type IssueSelectionMode = 'toggle' | 'range'

export function issueRangeIds(
  issueIds: string[],
  anchorId: string | null,
  targetId: string,
): string[] {
  const targetIndex = issueIds.indexOf(targetId)
  if (targetIndex < 0) {
    return []
  }

  const anchorIndex = anchorId ? issueIds.indexOf(anchorId) : -1
  if (anchorIndex < 0) {
    return [targetId]
  }

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return issueIds.slice(start, end + 1)
}

export function toggleIssueSelection(selectedIds: Set<string>, issueId: string): Set<string> {
  const next = new Set(selectedIds)
  if (next.has(issueId)) {
    next.delete(issueId)
  }
 else {
    next.add(issueId)
  }
  return next
}

export function addIssueSelectionRange(
  selectedIds: Set<string>,
  issueIds: string[],
  anchorId: string | null,
  targetId: string,
): Set<string> {
  const next = new Set(selectedIds)
  for (const issueId of issueRangeIds(issueIds, anchorId, targetId)) {
    next.add(issueId)
  }
  return next
}

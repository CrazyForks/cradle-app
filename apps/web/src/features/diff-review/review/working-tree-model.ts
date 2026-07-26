/**
 * View model for the local-changes surface.
 *
 * Deliberately *not* the PR-shaped `CradleDiffReview`. The working tree has no
 * review lifecycle — nothing to approve, no reviewers, no merge, no "updated N
 * minutes ago" (it is live; you are editing it right now). Modelling it with the
 * review type is exactly what made the old page read as nonsense. Here the nouns
 * are the ones git actually has: a branch, staged and unstaged files, a commit
 * you are about to write.
 */

export type WorkingTreeFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface WorkingTreeFile {
  id: string
  path: string
  previousPath: string | null
  status: WorkingTreeFileStatus
  /** Whether this file's changes are staged for the next commit. */
  staged: boolean
  additions: number
  deletions: number
  isBinary: boolean
}

export interface WorkingTreeModel {
  /** `owner/name` or the local directory name — display only. */
  repositoryLabel: string
  /** The branch the commit would land on. */
  branch: string
  /** Divergence from the tracked upstream, when there is one. */
  upstream: { ahead: number, behind: number } | null
  files: WorkingTreeFile[]
}

export interface WorkingTreeTotals {
  files: number
  staged: number
  additions: number
  deletions: number
}

export function workingTreeTotals(model: WorkingTreeModel): WorkingTreeTotals {
  let additions = 0
  let deletions = 0
  let staged = 0
  for (const file of model.files) {
    additions += file.additions
    deletions += file.deletions
    if (file.staged) {
      staged += 1
    }
  }
  return { files: model.files.length, staged, additions, deletions }
}

export function partitionByStage(files: WorkingTreeFile[]): {
  staged: WorkingTreeFile[]
  unstaged: WorkingTreeFile[]
} {
  const staged: WorkingTreeFile[] = []
  const unstaged: WorkingTreeFile[] = []
  for (const file of files) {
    (file.staged ? staged : unstaged).push(file)
  }
  return { staged, unstaged }
}

/**
 * A commit is committable only once something is staged and the subject line is
 * non-empty — the same gate git enforces, surfaced before the button is pressed
 * rather than as an error after.
 */
export function canCommit(model: WorkingTreeModel, subject: string): boolean {
  return subject.trim().length > 0 && model.files.some(file => file.staged)
}

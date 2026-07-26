import type { WorkingTreeFile, WorkingTreeModel } from '../working-tree-model'

function file(
  id: string,
  path: string,
  status: WorkingTreeFile['status'],
  staged: boolean,
  additions: number,
  deletions: number,
  overrides: Partial<WorkingTreeFile> = {},
): WorkingTreeFile {
  return {
    id,
    path,
    previousPath: null,
    status,
    staged,
    additions,
    deletions,
    isBinary: false,
    ...overrides,
  }
}

/** Mid-session state: some files already staged, some not, one untracked, one rename. */
export const workingTreeFixture: WorkingTreeModel = {
  repositoryLabel: 'wibus-wee/cradle-app',
  branch: 'feat/diffs-repository-ownership',
  upstream: { ahead: 2, behind: 0 },
  files: [
    file('w1', 'apps/web/src/features/diff-review/review/review-detail-view.tsx', 'added', true, 214, 0),
    file('w2', 'apps/web/src/features/diff-review/review/review-file-rail.tsx', 'added', true, 186, 0),
    file('w3', 'apps/web/src/features/diff-review/shared/diff-items.ts', 'modified', true, 24, 31),
    file('w4', 'apps/web/src/features/diff-review/reviews-list-page.tsx', 'deleted', false, 0, 1216),
    file('w5', 'apps/server/src/modules/diff-review/service.ts', 'modified', false, 143, 96),
    file('w6', 'apps/server/src/modules/diff-review/model.ts', 'modified', false, 38, 22),
    file(
      'w7',
      'packages/db/src/schema/repository.ts',
      'renamed',
      false,
      12,
      3,
      { previousPath: 'packages/db/src/schema/repo.ts' },
    ),
    file('w8', 'notes/scratch.md', 'untracked', false, 42, 0),
    file('w9', 'apps/web/public/diff-preview.png', 'added', false, 0, 0, { isBinary: true }),
  ],
}

export const cleanWorkingTreeFixture: WorkingTreeModel = {
  repositoryLabel: 'wibus-wee/cradle-app',
  branch: 'main',
  upstream: { ahead: 0, behind: 0 },
  files: [],
}

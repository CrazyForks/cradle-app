import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps, workspaces } from './shared'

/**
 * Canonical identity of a code repository, independent of where (or whether) it
 * is checked out locally.
 *
 * A workspace is a *checkout*, not a repository: the same repository can be open
 * in several workspaces (managed worktrees), and a repository can be known to
 * Cradle with no checkout at all (a GitHub pull request you were asked to
 * review). Anything that belongs to the code itself — diff reviews above all —
 * hangs off this table so it can never end up filed under an unrelated project.
 */
export const repositories = sqliteTable('repositories', {
  id: textPk(),
  /**
   * Normalized, host-qualified identity. `github:owner/name` whenever a GitHub
   * remote is known, otherwise `local:<absolute repo root>`. This is the join
   * key used to recognize that a pull request and a local checkout are the same
   * repository.
   */
  remoteKey: text('remote_key').notNull(),
  hostKind: text('host_kind', { enum: ['github', 'local'] }).notNull(),
  /** GitHub owner/org. Null for repositories with no recognized remote. */
  owner: text('owner'),
  /** Repository name, or the directory basename for local-only repositories. */
  name: text('name').notNull(),
  defaultBranch: text('default_branch'),
  ...timestamps(),
}, table => ({
  remoteKeyUnique: uniqueIndex('repositories_remote_key_unique').on(table.remoteKey),
  byHostKind: index('repositories_host_kind_idx').on(table.hostKind),
}))

/**
 * A local checkout of a repository. One row per (workspace, repo root), so a
 * workspace containing several repositories — or several worktrees of one
 * repository — is representable without overloading a single path column.
 */
export const workspaceRepositories = sqliteTable('workspace_repositories', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repositoryId: text('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  /** Absolute path of the checkout root. This is the cwd git commands run in. */
  localRoot: text('local_root').notNull(),
  /** The checkout the workspace itself points at, as opposed to a nested repo. */
  isPrimary: int('is_primary', { mode: 'boolean' }).notNull().default(false),
  ...timestamps(),
}, table => ({
  byWorkspace: index('workspace_repositories_workspace_id_idx').on(table.workspaceId),
  byRepository: index('workspace_repositories_repository_id_idx').on(table.repositoryId),
  workspaceRootUnique: uniqueIndex('workspace_repositories_workspace_root_unique').on(
    table.workspaceId,
    table.localRoot,
  ),
}))

export type Repository = typeof repositories.$inferSelect
export type NewRepository = typeof repositories.$inferInsert
export type WorkspaceRepository = typeof workspaceRepositories.$inferSelect
export type NewWorkspaceRepository = typeof workspaceRepositories.$inferInsert

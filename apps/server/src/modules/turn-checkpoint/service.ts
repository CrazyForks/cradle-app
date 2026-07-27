import { randomUUID } from 'node:crypto'

import { backendRuns, turnCheckpoints } from '@cradle/db'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import * as Maintenance from '../maintenance/service'
import { assertAppFeatureFlagEnabled, isAppFeatureFlagEnabled } from '../preferences/service'
import {
  captureCheckpoint,
  deleteCheckpointRefs,
  isGitWorkspace,
  restoreCheckpoint,
  summarizeCheckpointDiff,
} from './git-store'

const CHECKPOINT_PREFIX = 'refs/cradle/checkpoints'
const checkpointInsertOrder = sql`turn_checkpoints.rowid`
const CLEANUP_BATCH_SIZE = 50
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000

type CleanupReason = NonNullable<TurnCheckpointView['cleanupReason']>
type ClaimableStatus = Exclude<TurnCheckpointView['status'], 'cleanup_pending'>

export interface TurnCheckpointCleanupResult {
  claimed: number
  cleaned: number
  failed: number
}

function refToken(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function checkpointRefs(sessionId: string, runId: string) {
  const family = `${CHECKPOINT_PREFIX}/${refToken(sessionId)}/${refToken(runId)}`
  return { startRef: `${family}/start`, endRef: `${family}/end` }
}

export type TurnCheckpointView = typeof turnCheckpoints.$inferSelect

export interface HistoricalRewindPlan {
  checkpoint: TurnCheckpointView
  rollbackTurns: number
  subsequentCheckpoints: TurnCheckpointView[]
}

export function isTurnCheckpointsEnabled(): boolean {
  return isAppFeatureFlagEnabled('turnCheckpoints')
}

export function assertTurnCheckpointsEnabled(): void {
  assertAppFeatureFlagEnabled('turnCheckpoints', {
    code: 'turn_checkpoints_disabled',
    status: 403,
    message: 'Turn checkpoints are disabled. Enable them in Cradle settings first.',
  })
}

export async function captureRunStart(input: {
  sessionId: string
  runId: string
  assistantMessageId: string | null
  workspaceId: string | null
  workspacePath: string | null
}): Promise<TurnCheckpointView | null> {
  if (!isTurnCheckpointsEnabled()) {
    return null
  }
  if (!input.workspacePath || !(await isGitWorkspace(input.workspacePath))) {
    return null
  }
  const existing = db().select().from(turnCheckpoints).where(and(
    eq(turnCheckpoints.sessionId, input.sessionId),
    eq(turnCheckpoints.runId, input.runId),
  )).get()
  if (
    existing?.status === 'completed'
    || existing?.status === 'capturing'
    || existing?.status === 'cleanup_pending'
  ) {
    return existing
  }

  const now = currentUnixSeconds()
  const refs = checkpointRefs(input.sessionId, input.runId)
  const id = existing?.id ?? randomUUID()
  db().insert(turnCheckpoints).values({
    id,
    sessionId: input.sessionId,
    runId: input.runId,
    assistantMessageId: input.assistantMessageId,
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    ...refs,
    status: 'capturing',
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [turnCheckpoints.sessionId, turnCheckpoints.runId],
    set: {
      assistantMessageId: input.assistantMessageId,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      startRef: refs.startRef,
      endRef: null,
      status: 'capturing',
      cleanupReason: null,
      cleanupClaimedAt: null,
      errorText: null,
      updatedAt: now,
    },
  }).run()

  try {
    await captureCheckpoint(input.workspacePath, refs.startRef)
    return requireCheckpoint(id)
  }
  catch (error) {
    markFailed(id, error)
    throw error
  }
}

export async function captureRunEnd(input: {
  sessionId: string
  runId: string
}): Promise<TurnCheckpointView | null> {
  if (!isTurnCheckpointsEnabled()) {
    return null
  }
  const row = db().select().from(turnCheckpoints).where(and(
    eq(turnCheckpoints.sessionId, input.sessionId),
    eq(turnCheckpoints.runId, input.runId),
  )).get()
  if (!row) {
    return null
  }
  if (row.status === 'completed') {
    return row
  }
  const { endRef } = checkpointRefs(input.sessionId, input.runId)
  try {
    await captureCheckpoint(row.workspacePath, endRef)
    const summary = await summarizeCheckpointDiff(row.workspacePath, row.startRef, endRef)
    const now = currentUnixSeconds()
    db().update(turnCheckpoints).set({
      endRef,
      status: 'completed',
      ...summary,
      completedAt: now,
      errorText: null,
      updatedAt: now,
    }).where(eq(turnCheckpoints.id, row.id)).run()
    return requireCheckpoint(row.id)
  }
  catch (error) {
    markFailed(row.id, error)
    throw error
  }
}

export function listForSession(sessionId: string): TurnCheckpointView[] {
  return db()
    .select()
    .from(turnCheckpoints)
    .where(and(
      eq(turnCheckpoints.sessionId, sessionId),
      ne(turnCheckpoints.status, 'cleanup_pending'),
    ))
    .orderBy(desc(checkpointInsertOrder))
    .all()
}

export function get(checkpointId: string): TurnCheckpointView | null {
  return db().select().from(turnCheckpoints).where(eq(turnCheckpoints.id, checkpointId)).get() ?? null
}

export async function restoreWorkspaceStart(input: {
  sessionId: string
  checkpointId: string
}): Promise<TurnCheckpointView> {
  const row = get(input.checkpointId)
  if (!row || row.sessionId !== input.sessionId) {
    throw new AppError({
      code: 'turn_checkpoint_not_found',
      status: 404,
      message: 'Turn checkpoint not found',
      details: input,
    })
  }
  const latest = listForSession(input.sessionId).find(checkpoint => checkpoint.status === 'completed')
  if (latest?.id !== row.id) {
    throw new AppError({
      code: 'turn_checkpoint_restore_not_latest',
      status: 409,
      message: 'Only the latest completed turn can be restored safely',
      details: { sessionId: input.sessionId, checkpointId: input.checkpointId, latestCheckpointId: latest?.id ?? null },
    })
  }
  const restored = await restoreCheckpoint(row.workspacePath, row.startRef)
  if (!restored) {
    throw new AppError({
      code: 'turn_checkpoint_ref_missing',
      status: 409,
      message: 'The hidden Git ref for this turn checkpoint is unavailable',
      details: { checkpointId: row.id, ref: row.startRef },
    })
  }
  db().update(turnCheckpoints).set({
    restoredAt: currentUnixSeconds(),
    updatedAt: currentUnixSeconds(),
  }).where(eq(turnCheckpoints.id, row.id)).run()
  return requireCheckpoint(row.id)
}

export function planHistoricalRewind(input: {
  sessionId: string
  checkpointId: string
}): HistoricalRewindPlan {
  const checkpoint = requireSessionCheckpoint(input)
  if (checkpoint.status !== 'completed' || !checkpoint.endRef) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_not_completed',
      status: 409,
      message: 'Only a completed turn checkpoint can be used as a rewind target',
      details: { ...input, checkpointStatus: checkpoint.status },
    })
  }

  const checkpoints = listForSession(input.sessionId)
  const targetIndex = checkpoints.findIndex(candidate => candidate.id === checkpoint.id)
  const subsequentCheckpoints = checkpoints.slice(0, targetIndex)
  if (subsequentCheckpoints.length === 0) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_no_later_turns',
      status: 409,
      message: 'The selected checkpoint is already the latest completed turn',
      details: input,
    })
  }

  const incompleteCheckpoint = subsequentCheckpoints.find(candidate =>
    candidate.status !== 'completed' || !candidate.endRef)
  if (incompleteCheckpoint) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_history_incomplete',
      status: 409,
      message: 'A later turn does not have a completed checkpoint',
      details: {
        ...input,
        incompleteCheckpointId: incompleteCheckpoint.id,
        incompleteCheckpointStatus: incompleteCheckpoint.status,
      },
    })
  }

  const movedCheckpoint = subsequentCheckpoints.find(candidate =>
    candidate.workspacePath !== checkpoint.workspacePath)
  if (movedCheckpoint) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_workspace_changed',
      status: 409,
      message: 'Cannot rewind checkpoints captured from different workspace paths',
      details: {
        ...input,
        targetWorkspacePath: checkpoint.workspacePath,
        changedCheckpointId: movedCheckpoint.id,
        changedWorkspacePath: movedCheckpoint.workspacePath,
      },
    })
  }

  return {
    checkpoint,
    rollbackTurns: subsequentCheckpoints.length,
    subsequentCheckpoints,
  }
}

export async function restoreHistoricalCheckpoint(input: {
  sessionId: string
  checkpointId: string
  expectedSubsequentCheckpointIds: string[]
}): Promise<TurnCheckpointView> {
  const plan = planHistoricalRewind(input)
  const subsequentCheckpointIds = plan.subsequentCheckpoints.map(checkpoint => checkpoint.id)
  if (!sameIds(subsequentCheckpointIds, input.expectedSubsequentCheckpointIds)) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_history_changed',
      status: 409,
      message: 'Turn checkpoint history changed before rewind could start',
      details: {
        sessionId: input.sessionId,
        checkpointId: input.checkpointId,
        expectedSubsequentCheckpointIds: input.expectedSubsequentCheckpointIds,
        actualSubsequentCheckpointIds: subsequentCheckpointIds,
      },
    })
  }

  const restored = await restoreCheckpoint(plan.checkpoint.workspacePath, plan.checkpoint.endRef!)
  if (!restored) {
    throw new AppError({
      code: 'turn_checkpoint_ref_missing',
      status: 409,
      message: 'The hidden Git ref for this turn checkpoint is unavailable',
      details: { checkpointId: plan.checkpoint.id, ref: plan.checkpoint.endRef },
    })
  }

  const now = currentUnixSeconds()
  db().update(turnCheckpoints).set({
    restoredAt: now,
    updatedAt: now,
  }).where(eq(turnCheckpoints.id, plan.checkpoint.id)).run()
  return requireCheckpoint(plan.checkpoint.id)
}

export async function cleanupHistoricalRewind(input: {
  sessionId: string
  checkpointId: string
  subsequentCheckpointIds: string[]
}): Promise<void> {
  const plan = planHistoricalRewind(input)
  const actualSubsequentCheckpointIds = plan.subsequentCheckpoints.map(checkpoint => checkpoint.id)
  if (!sameIds(actualSubsequentCheckpointIds, input.subsequentCheckpointIds)) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_history_changed',
      status: 409,
      message: 'Turn checkpoint history changed before rewind cleanup completed',
      details: {
        ...input,
        actualSubsequentCheckpointIds,
      },
    })
  }

  const claimed = claimCheckpointIds(
    input.subsequentCheckpointIds,
    'historical-rewind',
    ['completed'],
  )
  if (claimed !== input.subsequentCheckpointIds.length) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_history_changed',
      status: 409,
      message: 'Turn checkpoint history changed while rewind cleanup was claimed',
      details: { ...input, claimed },
    })
  }
  const result = await cleanupClaimedCheckpoints(input.subsequentCheckpointIds)
  if (result.failed > 0) {
    throw new Error(`Failed to clean ${result.failed} turn checkpoint Git ref set(s)`)
  }
}

export async function prepareSessionDeletion(sessionId: string): Promise<void> {
  const rows = db()
    .select({ id: turnCheckpoints.id, status: turnCheckpoints.status })
    .from(turnCheckpoints)
    .where(eq(turnCheckpoints.sessionId, sessionId))
    .all()
  const unclaimed = rows.filter(row => row.status !== 'cleanup_pending')
  claimCheckpointIds(
    unclaimed.map(row => row.id),
    'session-delete',
    ['capturing', 'completed', 'failed'],
  )
  const result = await cleanupClaimedCheckpoints(rows.map(row => row.id))
  if (result.failed > 0) {
    throw new AppError({
      code: 'turn_checkpoint_cleanup_failed',
      status: 503,
      message: 'Turn checkpoint refs could not be cleaned before deleting the session.',
      details: { sessionId, failed: result.failed },
    })
  }
}

export async function maintainTurnCheckpointCleanup(
  limit = CLEANUP_BATCH_SIZE,
): Promise<TurnCheckpointCleanupResult> {
  const pendingIds = db().transaction((tx) => {
    const existingPending = tx
      .select({ id: turnCheckpoints.id })
      .from(turnCheckpoints)
      .where(eq(turnCheckpoints.status, 'cleanup_pending'))
      .orderBy(asc(turnCheckpoints.cleanupClaimedAt), asc(checkpointInsertOrder))
      .limit(limit)
      .all()
      .map(row => row.id)
    const remaining = limit - existingPending.length
    if (remaining <= 0) {
      return existingPending
    }

    const terminalIds = tx
      .select({ id: turnCheckpoints.id })
      .from(turnCheckpoints)
      .innerJoin(backendRuns, and(
        eq(turnCheckpoints.runId, backendRuns.id),
        eq(turnCheckpoints.sessionId, backendRuns.chatSessionId),
      ))
      .where(and(
        inArray(turnCheckpoints.status, ['capturing', 'failed']),
        inArray(backendRuns.status, ['complete', 'aborted', 'failed']),
      ))
      .orderBy(asc(turnCheckpoints.updatedAt), asc(checkpointInsertOrder))
      .limit(remaining)
      .all()
      .map(row => row.id)
    if (terminalIds.length > 0) {
      const now = currentUnixSeconds()
      tx.update(turnCheckpoints).set({
        status: 'cleanup_pending',
        cleanupReason: 'terminal-run',
        cleanupClaimedAt: now,
        errorText: null,
        updatedAt: now,
      }).where(and(
        inArray(turnCheckpoints.id, terminalIds),
        inArray(turnCheckpoints.status, ['capturing', 'failed']),
      )).run()
    }
    return [...existingPending, ...terminalIds]
  })

  const result = await cleanupClaimedCheckpoints(pendingIds)
  return { claimed: pendingIds.length, ...result }
}

export function registerTurnCheckpointMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'turn-checkpoint',
    key: 'cleanup-unusable-checkpoints',
    title: 'Clean unusable turn checkpoints',
    intervalMs: CLEANUP_INTERVAL_MS,
    runOnStart: true,
    manuallyRunnable: true,
    async run(context) {
      const result = await maintainTurnCheckpointCleanup()
      context.report({ ...result })
      if (result.failed > 0) {
        throw new Error(`Failed to clean ${result.failed} turn checkpoint Git ref set(s)`)
      }
      return { ...result }
    },
  })
}

function claimCheckpointIds(
  ids: string[],
  reason: CleanupReason,
  statuses: ClaimableStatus[],
): number {
  if (ids.length === 0) {
    return 0
  }
  const now = currentUnixSeconds()
  return db().transaction(tx => tx
    .update(turnCheckpoints)
    .set({
      status: 'cleanup_pending',
      cleanupReason: reason,
      cleanupClaimedAt: now,
      errorText: null,
      updatedAt: now,
    })
    .where(and(
      inArray(turnCheckpoints.id, ids),
      inArray(turnCheckpoints.status, statuses),
    ))
    .run()
.changes)
}

async function cleanupClaimedCheckpoints(
  ids: string[],
): Promise<Omit<TurnCheckpointCleanupResult, 'claimed'>> {
  if (ids.length === 0) {
    return { cleaned: 0, failed: 0 }
  }
  const rows = db()
    .select()
    .from(turnCheckpoints)
    .where(and(
      inArray(turnCheckpoints.id, ids),
      eq(turnCheckpoints.status, 'cleanup_pending'),
    ))
    .all()
  let cleaned = 0
  let failed = 0
  for (const row of rows) {
    try {
      await deleteCheckpointRefs(
        row.workspacePath,
        row.endRef ? [row.startRef, row.endRef] : [row.startRef],
      )
      db().delete(turnCheckpoints).where(and(
        eq(turnCheckpoints.id, row.id),
        eq(turnCheckpoints.status, 'cleanup_pending'),
      )).run()
      cleaned += 1
    }
    catch (error) {
      failed += 1
      db().update(turnCheckpoints).set({
        errorText: error instanceof Error ? error.message : String(error),
        updatedAt: currentUnixSeconds(),
      }).where(and(
        eq(turnCheckpoints.id, row.id),
        eq(turnCheckpoints.status, 'cleanup_pending'),
      )).run()
    }
  }
  return { cleaned, failed }
}

function requireSessionCheckpoint(input: {
  sessionId: string
  checkpointId: string
}): TurnCheckpointView {
  const checkpoint = get(input.checkpointId)
  if (!checkpoint || checkpoint.sessionId !== input.sessionId) {
    throw new AppError({
      code: 'turn_checkpoint_not_found',
      status: 404,
      message: 'Turn checkpoint not found',
      details: input,
    })
  }
  return checkpoint
}

function sameIds(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index])
}

function requireCheckpoint(id: string): TurnCheckpointView {
  const row = get(id)
  if (!row) {
    throw new Error(`Turn checkpoint ${id} disappeared during update`)
  }
  return row
}

function markFailed(id: string, error: unknown): void {
  db().update(turnCheckpoints).set({
    status: 'failed',
    errorText: error instanceof Error ? error.message : String(error),
    updatedAt: currentUnixSeconds(),
  }).where(eq(turnCheckpoints.id, id)).run()
}

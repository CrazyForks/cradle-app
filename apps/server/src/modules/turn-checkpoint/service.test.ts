import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRuns, sessions, turnCheckpoints } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import {
  captureRunStart,
  cleanupHistoricalRewind,
  listForSession,
  maintainTurnCheckpointCleanup,
  planHistoricalRewind,
  prepareSessionDeletion,
  restoreHistoricalCheckpoint,
} from './service'

const gitStoreMocks = vi.hoisted(() => ({
  captureCheckpoint: vi.fn(),
  deleteCheckpointRefs: vi.fn(),
  isGitWorkspace: vi.fn(),
  restoreCheckpoint: vi.fn(),
  summarizeCheckpointDiff: vi.fn(),
}))
const preferencesMocks = vi.hoisted(() => ({
  isAppFeatureFlagEnabled: vi.fn(() => true),
}))

vi.mock('./git-store', () => gitStoreMocks)
vi.mock('../preferences/service', () => ({
  assertAppFeatureFlagEnabled: vi.fn(),
  isAppFeatureFlagEnabled: preferencesMocks.isAppFeatureFlagEnabled,
}))

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousDbPath = process.env.CRADLE_DB_PATH
let dataDir: string | null = null

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-turn-checkpoint-service-'))
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH
  vi.clearAllMocks()
  preferencesMocks.isAppFeatureFlagEnabled.mockReturnValue(true)
  gitStoreMocks.restoreCheckpoint.mockResolvedValue(true)
  gitStoreMocks.deleteCheckpointRefs.mockResolvedValue(undefined)
  db().insert(sessions).values({
    id: 'session-1',
    title: 'Checkpoint rewind test',
    createdAt: 1,
    updatedAt: 1,
  }).run()
})

afterEach(() => {
  shutdownInfra()
  if (dataDir) {
    rmSync(dataDir, { recursive: true, force: true })
    dataDir = null
  }
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
  if (previousDbPath === undefined) {
    delete process.env.CRADLE_DB_PATH
  }
  else {
    process.env.CRADLE_DB_PATH = previousDbPath
  }
})

function seedCheckpoint(
  id: string,
  runId: string,
  status: 'capturing' | 'completed' | 'failed' = 'completed',
): void {
  db().insert(turnCheckpoints).values({
    id,
    sessionId: 'session-1',
    runId,
    assistantMessageId: `assistant-${runId}`,
    workspaceId: null,
    workspacePath: '/tmp/workspace',
    startRef: `refs/cradle/checkpoints/session/${runId}/start`,
    endRef: status === 'completed' ? `refs/cradle/checkpoints/session/${runId}/end` : null,
    status,
    completedAt: status === 'completed' ? 1 : null,
    createdAt: 1,
    updatedAt: 1,
  }).run()
}

function seedRun(runId: string, status: 'streaming' | 'complete' | 'aborted' | 'failed'): void {
  db().insert(backendRuns).values({
    id: runId,
    chatSessionId: 'session-1',
    origin: 'user',
    status,
    startedAt: 1,
  }).run()
}

function seedHistory(): void {
  seedCheckpoint('checkpoint-1', 'run-1')
  seedCheckpoint('checkpoint-2', 'run-2')
  seedCheckpoint('checkpoint-3', 'run-3')
}

describe('turn checkpoint feature flag', () => {
  it('does not inspect or write the repository while disabled', async () => {
    preferencesMocks.isAppFeatureFlagEnabled.mockReturnValue(false)

    await expect(captureRunStart({
      sessionId: 'session-1',
      runId: 'run-disabled',
      assistantMessageId: null,
      workspaceId: null,
      workspacePath: '/tmp/workspace',
    })).resolves.toBeNull()

    expect(gitStoreMocks.isGitWorkspace).not.toHaveBeenCalled()
    expect(gitStoreMocks.captureCheckpoint).not.toHaveBeenCalled()
    expect(db().select().from(turnCheckpoints).all()).toEqual([])
  })
})

describe('historical checkpoint rewind', () => {
  it('uses insertion order when checkpoint timestamps are equal', () => {
    seedHistory()

    expect(listForSession('session-1').map(checkpoint => checkpoint.id)).toEqual([
      'checkpoint-3',
      'checkpoint-2',
      'checkpoint-1',
    ])
    expect(planHistoricalRewind({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
    })).toMatchObject({
      checkpoint: { id: 'checkpoint-1' },
      rollbackTurns: 2,
      subsequentCheckpoints: [{ id: 'checkpoint-3' }, { id: 'checkpoint-2' }],
    })
  })

  it('rejects the latest checkpoint because rewinding to it would be a no-op', () => {
    seedHistory()

    expect(() => planHistoricalRewind({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-3',
    })).toThrow(expect.objectContaining({
      code: 'turn_checkpoint_rewind_no_later_turns',
      status: 409,
    }))
  })

  it('restores the target end ref after revalidating the planned history', async () => {
    seedHistory()

    await expect(restoreHistoricalCheckpoint({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      expectedSubsequentCheckpointIds: ['checkpoint-3', 'checkpoint-2'],
    })).resolves.toMatchObject({ id: 'checkpoint-1' })

    expect(gitStoreMocks.restoreCheckpoint).toHaveBeenCalledWith(
      '/tmp/workspace',
      'refs/cradle/checkpoints/session/run-1/end',
    )
  })

  it('deletes only checkpoints after the rewind target', async () => {
    seedHistory()

    await cleanupHistoricalRewind({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      subsequentCheckpointIds: ['checkpoint-3', 'checkpoint-2'],
    })

    expect(gitStoreMocks.deleteCheckpointRefs).toHaveBeenNthCalledWith(1, '/tmp/workspace', [
      'refs/cradle/checkpoints/session/run-2/start',
      'refs/cradle/checkpoints/session/run-2/end',
    ])
    expect(gitStoreMocks.deleteCheckpointRefs).toHaveBeenNthCalledWith(2, '/tmp/workspace', [
      'refs/cradle/checkpoints/session/run-3/start',
      'refs/cradle/checkpoints/session/run-3/end',
    ])
    expect(listForSession('session-1').map(checkpoint => checkpoint.id)).toEqual(['checkpoint-1'])
  })
})

describe('turn checkpoint cleanup', () => {
  it('claims and cleans only unusable checkpoints whose run is terminal', async () => {
    seedRun('run-terminal', 'failed')
    seedRun('run-active', 'streaming')
    seedCheckpoint('checkpoint-terminal', 'run-terminal', 'failed')
    seedCheckpoint('checkpoint-active', 'run-active', 'capturing')

    await expect(maintainTurnCheckpointCleanup()).resolves.toEqual({
      claimed: 1,
      cleaned: 1,
      failed: 0,
    })

    expect(gitStoreMocks.deleteCheckpointRefs).toHaveBeenCalledWith('/tmp/workspace', [
      'refs/cradle/checkpoints/session/run-terminal/start',
    ])
    expect(db().select().from(turnCheckpoints).all()).toEqual([
      expect.objectContaining({ id: 'checkpoint-active', status: 'capturing' }),
    ])
  })

  it('retains a durable claim after Git cleanup failure and completes on retry', async () => {
    seedRun('run-failed-cleanup', 'aborted')
    seedCheckpoint('checkpoint-failed-cleanup', 'run-failed-cleanup', 'failed')
    gitStoreMocks.deleteCheckpointRefs.mockRejectedValueOnce(new Error('git unavailable'))

    await expect(maintainTurnCheckpointCleanup()).resolves.toEqual({
      claimed: 1,
      cleaned: 0,
      failed: 1,
    })
    expect(db().select().from(turnCheckpoints).get()).toEqual(expect.objectContaining({
      id: 'checkpoint-failed-cleanup',
      status: 'cleanup_pending',
      cleanupReason: 'terminal-run',
      errorText: 'git unavailable',
    }))

    await expect(maintainTurnCheckpointCleanup()).resolves.toEqual({
      claimed: 1,
      cleaned: 1,
      failed: 0,
    })
    expect(db().select().from(turnCheckpoints).all()).toEqual([])
  })

  it('blocks session deletion until every checkpoint ref has been cleaned', async () => {
    seedCheckpoint('checkpoint-session-delete', 'run-session-delete')
    gitStoreMocks.deleteCheckpointRefs.mockRejectedValueOnce(new Error('locked ref'))

    await expect(prepareSessionDeletion('session-1')).rejects.toMatchObject({
      code: 'turn_checkpoint_cleanup_failed',
      status: 503,
    })
    expect(db().select().from(turnCheckpoints).get()).toEqual(expect.objectContaining({
      status: 'cleanup_pending',
      cleanupReason: 'session-delete',
      errorText: 'locked ref',
    }))

    await expect(prepareSessionDeletion('session-1')).resolves.toBeUndefined()
    expect(db().select().from(turnCheckpoints).all()).toEqual([])
  })
})

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { captureKimiCliSession } from './kimi-session-capture'

const SESSION_ID = 'session_4243babe-c33c-4ca3-8245-689c9e34ba3b'
const WORKSPACE_PATH = '/tmp/kimi-workspace'
const STARTED_AT = 1_784_625_732_000

let homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.map(home => rm(home, { recursive: true, force: true })))
  homes = []
})

describe('captureKimiCliSession', () => {
  it('captures a title from a numeric-timestamp state file with unrelated metadata', async () => {
    const home = await writeKimiSession({
      createdAt: STARTED_AT + 100,
      updatedAt: STARTED_AT + 300,
      title: 'Native Kimi session title',
      futureMetadata: { version: 3, opaque: ['value'] },
    })

    await expect(captureKimiCliSession({
      workspacePath: WORKSPACE_PATH,
      startedAt: STARTED_AT,
      kimiCodeHome: home,
      now: () => STARTED_AT + 1_000,
    })).resolves.toMatchObject({
      sessionId: SESSION_ID,
      title: 'Native Kimi session title',
      workspacePath: WORKSPACE_PATH,
    })
  })

  it('accepts second-based timestamps and falls back to the last prompt', async () => {
    const home = await writeKimiSession({
      createdAt: (STARTED_AT + 100) / 1000,
      updatedAt: (STARTED_AT + 300) / 1000,
      title: 'New Session',
      lastPrompt: 'Title fallback from the user prompt',
    })

    await expect(captureKimiCliSession({
      workspacePath: WORKSPACE_PATH,
      startedAt: STARTED_AT,
      kimiCodeHome: home,
    })).resolves.toMatchObject({
      sessionId: SESSION_ID,
      title: 'Title fallback from the user prompt',
    })
  })
})

async function writeKimiSession(state: Record<string, unknown>): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'cradle-kimi-'))
  homes.push(home)
  const sessionDir = join(home, 'sessions', 'wd_kimi-workspace', SESSION_ID)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(join(sessionDir, 'state.json'), JSON.stringify({
    workDir: WORKSPACE_PATH,
    ...state,
  }))
  await writeFile(join(home, 'session_index.jsonl'), `${JSON.stringify({
    sessionId: SESSION_ID,
    sessionDir,
    workDir: WORKSPACE_PATH,
  })}\n`)
  return home
}

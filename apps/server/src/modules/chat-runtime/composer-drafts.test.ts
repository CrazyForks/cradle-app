import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { composerDrafts } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import {
  deleteComposerDraft,
  scrubDeletedComposerDraftPayloads,
  writeComposerDraft,
} from './composer-drafts'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-composer-drafts-'))
  process.env.CRADLE_DATA_DIR = dataDir
})

afterEach(() => {
  shutdownInfra()
  rmSync(dataDir, { recursive: true, force: true })
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
})

describe('composer draft maintenance', () => {
  it('keeps a deletion tombstone while removing its payload immediately', () => {
    writeComposerDraft({
      surfaceId: 'chat:one',
      draft: { text: 'large draft', contextParts: [], files: [], pastedTexts: [] },
    })
    const deleted = deleteComposerDraft('chat:one')

    expect(deleted).toMatchObject({ draft: null, revision: 2 })
    expect(db().select().from(composerDrafts).get()).toEqual(expect.objectContaining({
      surfaceId: 'chat:one',
      draftJson: '{}',
      revision: 2,
    }))
  })

  it('scrubs a bounded historical tombstone batch and becomes a no-op', () => {
    db().insert(composerDrafts).values([
      { surfaceId: 'deleted:one', draftJson: '{"text":"one"}', revision: 2, deletedAt: 10 },
      { surfaceId: 'deleted:two', draftJson: '{"text":"two"}', revision: 3, deletedAt: 20 },
      { surfaceId: 'active', draftJson: '{"text":"keep"}', revision: 1, deletedAt: null },
    ]).run()

    expect(scrubDeletedComposerDraftPayloads(1)).toBe(1)
    expect(scrubDeletedComposerDraftPayloads(10)).toBe(1)
    expect(scrubDeletedComposerDraftPayloads(10)).toBe(0)
    expect(db().select().from(composerDrafts).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ surfaceId: 'deleted:one', draftJson: '{}' }),
      expect.objectContaining({ surfaceId: 'deleted:two', draftJson: '{}' }),
      expect.objectContaining({ surfaceId: 'active', draftJson: '{"text":"keep"}' }),
    ]))
  })
})

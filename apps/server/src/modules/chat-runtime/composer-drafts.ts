import { composerDrafts } from '@cradle/db'
import type { FileUIPart } from 'ai'
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm'

import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import * as Maintenance from '../maintenance/service'
import type { ChatContextPart } from './context-parts'

export interface ComposerPastedTextPayload {
  id: string
  text: string
  lineCount: number
  charCount: number
}

export interface ComposerDraftPayload {
  text: string
  contextParts: ChatContextPart[]
  files: FileUIPart[]
  pastedTexts: ComposerPastedTextPayload[]
}

export interface ComposerDraftDto {
  surfaceId: string
  draft: ComposerDraftPayload | null
  revision: number
  updatedAt: number | null
  deletedAt: number | null
}

export function readComposerDraft(surfaceId: string): ComposerDraftDto {
  const row = db()
    .select()
    .from(composerDrafts)
    .where(eq(composerDrafts.surfaceId, surfaceId))
    .get()
  if (!row) {
    return {
      surfaceId,
      draft: null,
      revision: 0,
      updatedAt: null,
      deletedAt: null,
    }
  }

  return toComposerDraftDto(row)
}

export function writeComposerDraft(input: {
  surfaceId: string
  draft: ComposerDraftPayload
}): ComposerDraftDto {
  const existing = db()
    .select()
    .from(composerDrafts)
    .where(eq(composerDrafts.surfaceId, input.surfaceId))
    .get()
  const now = currentUnixSeconds()
  const revision = (existing?.revision ?? 0) + 1
  const draftJson = JSON.stringify(input.draft)

  db()
    .insert(composerDrafts)
    .values({
      surfaceId: input.surfaceId,
      draftJson,
      revision,
      deletedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: composerDrafts.surfaceId,
      set: {
        draftJson,
        revision,
        deletedAt: null,
        updatedAt: now,
      },
    })
    .run()

  return readComposerDraft(input.surfaceId)
}

export function deleteComposerDraft(surfaceId: string): ComposerDraftDto {
  const existing = db()
    .select()
    .from(composerDrafts)
    .where(eq(composerDrafts.surfaceId, surfaceId))
    .get()
  const now = currentUnixSeconds()
  const revision = (existing?.revision ?? 0) + 1

  db()
    .insert(composerDrafts)
    .values({
      surfaceId,
      draftJson: '{}',
      revision,
      deletedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: composerDrafts.surfaceId,
      set: {
        draftJson: '{}',
        revision,
        deletedAt: now,
        updatedAt: now,
      },
    })
    .run()

  return readComposerDraft(surfaceId)
}

export function scrubDeletedComposerDraftPayloads(limit = 100): number {
  return db().transaction((tx) => {
    const surfaceIds = tx
      .select({ surfaceId: composerDrafts.surfaceId })
      .from(composerDrafts)
      .where(and(isNotNull(composerDrafts.deletedAt), ne(composerDrafts.draftJson, '{}')))
      .limit(limit)
      .all()
      .map(row => row.surfaceId)
    if (surfaceIds.length === 0) {
      return 0
    }
    return tx
      .update(composerDrafts)
      .set({ draftJson: '{}' })
      .where(inArray(composerDrafts.surfaceId, surfaceIds))
      .run()
      .changes
  })
}

export function registerComposerDraftMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'chat-runtime',
    key: 'scrub-composer-tombstones',
    title: 'Scrub deleted composer drafts',
    intervalMs: 60 * 60 * 1000,
    runOnStart: true,
    manuallyRunnable: true,
    run: () => ({ scrubbed: scrubDeletedComposerDraftPayloads() }),
  })
}

function toComposerDraftDto(row: typeof composerDrafts.$inferSelect): ComposerDraftDto {
  return {
    surfaceId: row.surfaceId,
    draft: row.deletedAt === null ? normalizeComposerDraft(JSON.parse(row.draftJson)) : null,
    revision: row.revision,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

function normalizeComposerDraft(value: Partial<ComposerDraftPayload>): ComposerDraftPayload {
  return {
    text: typeof value.text === 'string' ? value.text : '',
    contextParts: Array.isArray(value.contextParts) ? value.contextParts : [],
    files: Array.isArray(value.files) ? value.files : [],
    pastedTexts: Array.isArray(value.pastedTexts) ? value.pastedTexts : [],
  }
}

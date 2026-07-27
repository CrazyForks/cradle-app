import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { rotateFileGenerations } from './logger'

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cradle-log-rotation-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('server log rotation', () => {
  it('rotates at the byte limit and discards generations beyond the cap', () => {
    const logFile = join(directory, 'server.log')
    writeFileSync(logFile, 'current')
    writeFileSync(`${logFile}.1`, 'previous')
    writeFileSync(`${logFile}.2`, 'old')

    expect(rotateFileGenerations(logFile, 7, 2)).toEqual({
      rotated: true,
      bytesBefore: 7,
      generations: 2,
    })
    expect(readFileSync(`${logFile}.1`, 'utf8')).toBe('current')
    expect(readFileSync(`${logFile}.2`, 'utf8')).toBe('previous')
  })

  it('leaves a file below the limit unchanged', () => {
    const logFile = join(directory, 'server.log')
    writeFileSync(logFile, 'small')

    expect(rotateFileGenerations(logFile, 6, 3)).toEqual({
      rotated: false,
      bytesBefore: 5,
      generations: 3,
    })
    expect(readFileSync(logFile, 'utf8')).toBe('small')
  })
})

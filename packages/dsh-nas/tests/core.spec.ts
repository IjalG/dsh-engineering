/**
 * Core dsh-nas unit tests: path-boundary safety, trash lifecycle, config
 * persistence, app registry. Run with `pnpm test` (vitest, node pool).
 */

import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppRegistry } from '../src/apps.ts'
import { readConfig, writeConfig } from '../src/config.ts'
import { resolveInside } from '../src/fsapi.ts'
import { isTextExt, NAS_SYS_DIR } from '../src/protocol.ts'
import { Trash } from '../src/trash.ts'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dsh-nas-test-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('resolveInside path boundary', () => {
  it('resolves a plain relative path', () => {
    expect(resolveInside(tmp, 'a/b.txt')).toBe(join(tmp, 'a', 'b.txt'))
  })

  it('resolves the root itself', () => {
    expect(resolveInside(tmp, '')).toBe(tmp)
  })

  it('rejects absolute paths', () => {
    expect(resolveInside(tmp, '/etc/passwd')).toBeUndefined()
  })

  it('rejects parent escapes', () => {
    expect(resolveInside(tmp, '../x')).toBeUndefined()
    expect(resolveInside(tmp, 'a/../../x')).toBeUndefined()
  })

  it('rejects the hidden system directory', () => {
    expect(resolveInside(tmp, `${NAS_SYS_DIR}/audit.jsonl`)).toBeUndefined()
    expect(resolveInside(tmp, `a/${NAS_SYS_DIR}/x`)).toBeUndefined()
  })

  it('rejects non-string and oversized input', () => {
    expect(resolveInside(tmp, '')).toBe(tmp)
    expect(resolveInside(tmp, 'x'.repeat(5000))).toBeUndefined()
  })
})

describe('Trash lifecycle', () => {
  it('stash moves the file, list shows it, restore brings it back', () => {
    const root = join(tmp, 'ws')
    mkdirSync(join(root, 'sub'), { recursive: true })
    const file = join(root, 'sub', 'a.txt')
    writeFileSync(file, 'hello')
    const trash = new Trash(root)

    trash.stash(file, 'sub/a.txt', 'file')
    expect(existsSync(file)).toBe(false)
    const listed = trash.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.originalPath).toBe('sub/a.txt')

    const outcome = trash.restore(listed[0]!.id, root)
    expect(outcome.ok).toBe(true)
    expect(readFileSync(join(root, 'sub', 'a.txt'), 'utf8')).toBe('hello')
    expect(trash.list()).toHaveLength(0)
  })

  it('restore refuses when the destination exists', () => {
    const root = join(tmp, 'ws')
    mkdirSync(root)
    writeFileSync(join(root, 'a.txt'), 'one')
    const trash = new Trash(root)
    trash.stash(join(root, 'a.txt'), 'a.txt', 'file')
    writeFileSync(join(root, 'a.txt'), 'two')

    const outcome = trash.restore(trash.list()[0]!.id, root)
    expect(outcome.ok).toBe(false)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('two')
  })

  it('empty removes everything and the index', () => {
    const root = join(tmp, 'ws')
    mkdirSync(root)
    writeFileSync(join(root, 'a.txt'), 'x')
    const trash = new Trash(root)
    trash.stash(join(root, 'a.txt'), 'a.txt', 'file')
    expect(trash.empty().ok).toBe(true)
    expect(trash.list()).toHaveLength(0)
  })

  it('stashes directories recursively', () => {
    const root = join(tmp, 'ws')
    mkdirSync(join(root, 'dir', 'inner'), { recursive: true })
    writeFileSync(join(root, 'dir', 'inner', 'x.txt'), 'x')
    const trash = new Trash(root)
    trash.stash(join(root, 'dir'), 'dir', 'dir')
    expect(existsSync(join(root, 'dir'))).toBe(false)
    expect(trash.restore(trash.list()[0]!.id, root).ok).toBe(true)
    expect(existsSync(join(root, 'dir', 'inner', 'x.txt'))).toBe(true)
  })
})

describe('config persistence', () => {
  it('round-trips prefs and writes 0600', () => {
    const path = join(tmp, 'cfg.json')
    writeConfig({ prefs: { mode: 'fullscreen', open: true } }, path)
    const loaded = readConfig(path)
    expect(loaded.prefs?.mode).toBe('fullscreen')
    const mode = statSync(path).mode
    expect(mode & 0o777).toBe(0o600)
  })

  it('tolerates a corrupt file', () => {
    const path = join(tmp, 'cfg.json')
    writeFileSync(path, '{broken')
    expect(readConfig(path)).toEqual({})
  })

  it('returns defaults for a missing file', () => {
    expect(readConfig(join(tmp, 'missing.json'))).toEqual({})
  })
})

describe('AppRegistry', () => {
  it('registers, lists sorted, resolves by extension, unregisters', () => {
    const registry = new AppRegistry()
    const disposer = registry.register({
      id: 'office', name: 'Office', icon: '', fileExts: ['docx', 'xlsx'],
      windowKind: 'office', packageName: '@linxin666/dsh-office',
    })
    registry.register({
      id: 'mail', name: 'Mail', icon: '', fileExts: [],
      windowKind: 'mail', packageName: '@linxin666/dsh-mail',
    })
    expect(registry.list().map((app) => app.id)).toEqual(['mail', 'office'])
    expect(registry.byExtension('DOCX')?.id).toBe('office')
    expect(registry.byExtension('pdf')).toBeUndefined()
    disposer()
    expect(registry.get('office')).toBeUndefined()
  })
})

describe('isTextExt', () => {
  it('classifies binary vs text extensions', () => {
    expect(isTextExt('txt')).toBe(true)
    expect(isTextExt('md')).toBe(true)
    expect(isTextExt('docx')).toBe(false)
    expect(isTextExt('PDF')).toBe(false)
    expect(isTextExt('')).toBe(true)
  })
})

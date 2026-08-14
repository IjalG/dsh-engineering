/**
 * Trash: delete moves the item into <workspace>/.nas/trash/<id>/ instead of
 * destroying; restore moves it back. The index lives at .nas/trash.json.
 * Empty trash is the only destructive path (and it is audited).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { NasActionResult, NasTrashEntry } from './protocol.ts'

interface TrashRecord {
  id: string
  originalPath: string
  name: string
  kind: 'file' | 'dir'
  size: number
  deletedAt: number
}

const MAX_TRASH_ITEMS = 500

/** Trash implementation bound to one workspace root. */
export class Trash {
  private readonly dir: string
  private readonly indexFile: string
  private records: TrashRecord[] = []

  constructor(root: string) {
    this.dir = join(root, '.nas', 'trash')
    this.indexFile = join(root, '.nas', 'trash.json')
    this.records = this.load()
  }

  private load(): TrashRecord[] {
    try {
      if (!existsSync(this.indexFile)) return []
      const parsed = JSON.parse(readFileSync(this.indexFile, 'utf8')) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is TrashRecord =>
        typeof item === 'object' && item !== null && typeof (item as TrashRecord).id === 'string')
    } catch {
      return []
    }
  }

  private save(): void {
    mkdirSync(dirname(this.indexFile), { recursive: true })
    writeFileSync(this.indexFile, JSON.stringify(this.records), 'utf8')
  }

  /** Move `path` into the trash. `rel` is the workspace-relative display path. */
  stash(path: string, rel: string, kind: 'file' | 'dir'): void {
    if (this.records.length >= MAX_TRASH_ITEMS) this.dropOldest()
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const target = join(this.dir, id)
    mkdirSync(this.dir, { recursive: true })
    renameSync(path, target)
    this.records.push({
      id,
      originalPath: rel,
      name: basename(path),
      kind,
      size: dirSize(target),
      deletedAt: Date.now(),
    })
    this.save()
  }

  list(): NasTrashEntry[] {
    return [...this.records]
      .sort((a, b) => b.deletedAt - a.deletedAt)
      .map((record) => ({
        id: record.id,
        originalPath: record.originalPath,
        name: record.name,
        size: record.size,
        deletedAt: record.deletedAt,
        kind: record.kind,
      }))
  }

  /** Restore one item into the workspace root (recreating parents). */
  restore(id: string, root: string): NasActionResult {
    const record = this.records.find((item) => item.id === id)
    if (record === undefined) return { ok: false, error: 'trash item not found' }
    const source = join(this.dir, id)
    if (!existsSync(source)) {
      this.records = this.records.filter((item) => item.id !== id)
      this.save()
      return { ok: false, error: 'trash item missing on disk' }
    }
    const target = join(root, record.originalPath)
    if (existsSync(target)) return { ok: false, error: `destination already exists: ${record.originalPath}` }
    try {
      mkdirSync(dirname(target), { recursive: true })
      renameSync(source, target)
      this.records = this.records.filter((item) => item.id !== id)
      this.save()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Empty the trash (destructive). */
  empty(): NasActionResult {
    try {
      if (existsSync(this.dir)) rmSync(this.dir, { recursive: true, force: true })
      this.records = []
      this.save()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private dropOldest(): void {
    const oldest = this.records.reduce<TrashRecord | undefined>((acc, item) =>
      acc === undefined || item.deletedAt < acc.deletedAt ? item : acc, undefined)
    if (oldest === undefined) return
    try {
      rmSync(join(this.dir, oldest.id), { recursive: true, force: true })
    } catch {
      // best effort
    }
    this.records = this.records.filter((item) => item.id !== oldest.id)
  }
}

function dirSize(path: string): number {
  try {
    const stat = require('node:fs').statSync(path) as { size: number; isDirectory(): boolean }
    if (!stat.isDirectory()) return stat.size
    let total = 0
    for (const name of readdirSync(path)) {
      total += dirSize(join(path, name))
    }
    return total
  } catch {
    return 0
  }
}

/**
 * Workspace-bound filesystem API for the desktop. Every path the browser
 * sends is a root-relative path; the root is resolved per-request from the
 * owning session's cwd (fallback: sandbox workspace root, then process cwd).
 * All mutating operations are audited; delete moves into the trash (see
 * trash.ts) instead of destroying.
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { audit } from './audit.ts'
import type { NasFsEntry, NasFsListResult, NasReadResult } from './protocol.ts'
import { NAS_SYS_DIR } from './protocol.ts'
import { Trash } from './trash.ts'
import { ReviewLedger } from './review.ts'
import { dbFor } from './db.ts'

/** Default text read cap. */
export const DEFAULT_MAX_READ_BYTES = 1024 * 1024
/** Hard read cap. */
export const MAX_READ_BYTES = 4 * 1024 * 1024
/** Write cap. */
export const MAX_WRITE_BYTES = 8 * 1024 * 1024

/** Root resolver: session cwd when available, else sandbox root, else cwd. */
export type RootResolver = (sessionId?: string) => string

/** Extensions whose content is binary (skipped by text preview/read). */
const BINARY_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'docx', 'xlsx', 'pptx', 'zip', 'gz', 'tar', '7z', 'mp4', 'mp3', 'wav', 'woff', 'woff2', 'ttf', 'otf', 'eot'])

/**
 * Resolve a root-relative path safely. Returns undefined when the path
 * escapes the root, is the system dir, or is otherwise invalid.
 */
export function resolveInside(root: string, rel: string): string | undefined {
  if (typeof rel !== 'string' || rel.length > 4096) return undefined
  if (isAbsolute(rel)) return undefined
  if (rel === '' || rel === '.') return root
  const resolved = resolve(root, rel)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (resolved !== root && !resolved.startsWith(prefix)) return undefined
  // Any path segment under the system directory is off-limits.
  const parts = resolved.slice(prefix.length).split(sep)
  if (parts.some((part) => part === NAS_SYS_DIR)) return undefined
  return resolved
}

/** Whether a path points at a directory. */
export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Build one entry record. */
function entryOf(root: string, path: string): NasFsEntry | undefined {
  try {
    const stat = statSync(path)
    const name = basename(path)
    return {
      name,
      path: path.slice(root.length).replace(/^[/\\]/, ''),
      kind: stat.isDirectory() ? 'dir' : 'file',
      size: stat.size,
      mtime: Math.trunc(stat.mtimeMs),
      ext: stat.isDirectory() ? '' : (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''),
    }
  } catch {
    return undefined
  }
}

/** Change hook signature (index maintenance). */
export type FsChangeHook = (root: string, rel: string, op: 'write' | 'mkdir' | 'move' | 'copy' | 'delete') => void

/** File system facade. */
export class FsApi {
  constructor(
    private readonly resolveRoot: RootResolver,
    private readonly onChange?: FsChangeHook,
  ) {}

  /** Resolve the workspace root for a session (public for M2 routes). */
  rootFor(sessionId?: string): string {
    return this.resolveRoot(sessionId)
  }

  /** Trash bound to a root (cheap: index is a small JSON read). */
  private trashFor(root: string): Trash {
    return new Trash(root)
  }

  /** Review ledger bound to a root (lazy). */
  private reviewFor(root: string): ReviewLedger {
    return new ReviewLedger(dbFor(root))
  }

  /** List a directory (root-relative path; empty = root). */
  list(rel: string, sessionId?: string): NasFsListResult {
    const root = this.resolveRoot(sessionId)
    const dir = resolveInside(root, rel ?? '')
    if (dir === undefined) return { root, entries: [], error: 'path outside workspace' }
    if (!existsSync(dir)) return { root, entries: [], error: 'no such directory' }
    if (!isDir(dir)) return { root, entries: [], error: 'not a directory' }
    const entries: NasFsEntry[] = []
    for (const name of readdirSync(dir)) {
      if (name === NAS_SYS_DIR) continue
      const entry = entryOf(root, join(dir, name))
      if (entry !== undefined) entries.push(entry)
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    return { root, entries }
  }

  /** Read a text file (bounded). */
  read(rel: string, maxBytes = DEFAULT_MAX_READ_BYTES, sessionId?: string): NasReadResult {
    const root = this.resolveRoot(sessionId)
    const path = resolveInside(root, rel ?? '')
    if (path === undefined) return { ok: false, error: 'path outside workspace' }
    if (!existsSync(path) || isDir(path)) return { ok: false, error: 'not a file' }
    const stat = statSync(path)
    const capped = Math.min(maxBytes, MAX_READ_BYTES)
    if (stat.size > capped) {
      const buffer = readFileSync(path)
      return { ok: true, content: buffer.subarray(0, capped).toString('utf8'), truncated: true, size: stat.size }
    }
    return { ok: true, content: readFileSync(path, 'utf8'), size: stat.size }
  }

  /** Write a text file (creates parent directories). */
  write(rel: string, content: string, sessionId?: string, staged = false): { ok: boolean; error?: string; reviewId?: number } {
    const root = this.resolveRoot(sessionId)
    const path = resolveInside(root, rel ?? '')
    if (path === undefined) return { ok: false, error: 'path outside workspace' }
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) return { ok: false, error: 'content too large' }
    try {
      let reviewId: number | undefined
      if (staged) {
        // Stage: snapshot the old content for the review ledger, then write.
        const oldContent = existsSync(path) && !isDir(path) ? readFileSync(path, 'utf8') : ''
        const ledger = this.reviewFor(root)
        reviewId = ledger.record(rel, oldContent, content, 'agent').id
      }
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf8')
      audit(root, { ts: Date.now(), op: 'write', path: rel, size: Buffer.byteLength(content, 'utf8'), ok: true })
      this.onChange?.(root, rel, 'write')
      return reviewId === undefined ? { ok: true } : { ok: true, reviewId }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  /** List review records (pending only when status given). */
  reviewList(root: string, status?: 'pending'): Array<{ id: number; path: string; status: string; createdAt: number; actor: string }> {
    try {
      return this.reviewFor(root).list(status, 100)
    } catch {
      return []
    }
  }

  /** Get one review record (with contents). */
  reviewGet(root: string, id: number): { id: number; path: string; oldContent: string; newContent: string; status: string; createdAt: number; actor: string } | undefined {
    try {
      return this.reviewFor(root).get(id)
    } catch {
      return undefined
    }
  }

  /** Accept a staged review: keep the new content. */
  acceptReview(id: number, sessionId?: string): { ok: boolean; error?: string } {
    const root = this.resolveRoot(sessionId)
    try {
      const ledger = this.reviewFor(root)
      ledger.accept(id)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  /** Reject a staged review: restore the old content. */
  rejectReview(id: number, sessionId?: string): { ok: boolean; error?: string } {
    const root = this.resolveRoot(sessionId)
    try {
      const ledger = this.reviewFor(root)
      const record = ledger.get(id)
      if (record === undefined) return { ok: false, error: 'review not found' }
      const path = resolveInside(root, record.path)
      if (path === undefined) return { ok: false, error: 'path outside workspace' }
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, record.oldContent, 'utf8')
      ledger.reject(id)
      this.onChange?.(root, record.path, 'write')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  /** Create a directory (recursive). */
  mkdir(rel: string, sessionId?: string): { ok: boolean; error?: string } {
    const root = this.resolveRoot(sessionId)
    const path = resolveInside(root, rel ?? '')
    if (path === undefined) return { ok: false, error: 'path outside workspace' }
    try {
      mkdirSync(path, { recursive: true })
      audit(root, { ts: Date.now(), op: 'mkdir', path: rel, ok: true })
      this.onChange?.(root, rel, 'mkdir')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  /** Move/rename (both must be inside the workspace). */
  move(src: string, dest: string, sessionId?: string): { ok: boolean; error?: string } {
    const root = this.resolveRoot(sessionId)
    const from = resolveInside(root, src ?? '')
    const to = resolveInside(root, dest ?? '')
    if (from === undefined || to === undefined) return { ok: false, error: 'path outside workspace' }
    if (from === to) return { ok: false, error: 'source equals destination' }
    if (!existsSync(from)) return { ok: false, error: 'source missing' }
    if (existsSync(to)) return { ok: false, error: 'destination exists' }
    try {
      mkdirSync(dirname(to), { recursive: true })
      renameSync(from, to)
      audit(root, { ts: Date.now(), op: 'move', path: src, to: dest, ok: true })
      this.onChange?.(root, src, 'move')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  /** Copy (both must be inside the workspace). */
  copy(src: string, dest: string, sessionId?: string): { ok: boolean; error?: string } {
    const root = this.resolveRoot(sessionId)
    const from = resolveInside(root, src ?? '')
    const to = resolveInside(root, dest ?? '')
    if (from === undefined || to === undefined) return { ok: false, error: 'path outside workspace' }
    if (from === to) return { ok: false, error: 'source equals destination' }
    if (!existsSync(from)) return { ok: false, error: 'source missing' }
    if (existsSync(to)) return { ok: false, error: 'destination exists' }
    try {
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to, { recursive: true })
      audit(root, { ts: Date.now(), op: 'copy', path: src, to: dest, ok: true })
      this.onChange?.(root, dest, 'copy')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  /** Delete into the trash (never destroys). */
  delete(rel: string, sessionId?: string): { ok: boolean; error?: string } {
    const root = this.resolveRoot(sessionId)
    const path = resolveInside(root, rel ?? '')
    if (path === undefined) return { ok: false, error: 'path outside workspace' }
    if (!existsSync(path)) return { ok: false, error: 'source missing' }
    try {
      const kind = isDir(path) ? 'dir' : 'file'
      this.trashFor(root).stash(path, rel, kind)
      audit(root, { ts: Date.now(), op: 'delete', path: rel, ok: true })
      this.onChange?.(root, rel, 'delete')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  /** List trash contents. */
  trashItems(sessionId?: string) {
    return this.trashFor(this.resolveRoot(sessionId)).list()
  }

  /** Restore one trash item. */
  restore(id: string, sessionId?: string): { ok: boolean; error?: string } {
    const root = this.resolveRoot(sessionId)
    const outcome = this.trashFor(root).restore(id, root)
    if (outcome.ok) audit(root, { ts: Date.now(), op: 'restore', path: `trash:${id}`, ok: true })
    return outcome
  }

  /** Empty the trash (destructive; audit records it). */
  emptyTrash(sessionId?: string): { ok: boolean; error?: string } {
    const root = this.resolveRoot(sessionId)
    const outcome = this.trashFor(root).empty()
    if (outcome.ok) audit(root, { ts: Date.now(), op: 'empty-trash', path: '.nas/trash', ok: true })
    return outcome
  }

  /** Whether a text read makes sense for this file (non-binary). */
  static isTextExt(ext: string): boolean {
    return !BINARY_EXTS.has(ext.toLowerCase())
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** lstat helper used by trash (symlink-safe listing). */
export function lstatKind(path: string): 'file' | 'dir' | 'other' {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other'
  } catch {
    return 'other'
  }
}

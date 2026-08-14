/**
 * Operation audit: append-only JSONL inside the workspace system directory
 * (.nas/audit.jsonl). Every mutating file operation (write/move/copy/delete/
 * restore/empty-trash) records who/what/when for the desktop's audit trail.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { NasActionResult } from './protocol.ts'

/** One audit record (lossless JSON). */
export interface AuditRecord {
  ts: number
  op: 'write' | 'mkdir' | 'move' | 'copy' | 'delete' | 'restore' | 'empty-trash' | 'open-app'
  path: string
  /** Destination for move/copy. */
  to?: string
  /** App id for open-app. */
  app?: string
  /** Bytes written for write. */
  size?: number
  ok: boolean
  error?: string
}

/** Appends one record; never throws (audit must not break the desktop). */
export function audit(root: string, record: AuditRecord): void {
  try {
    const dir = join(root, '.nas')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'audit.jsonl'), `${JSON.stringify(record)}\n`)
  } catch {
    // best effort
  }
}

/** Simple success wrapper for routes. */
export function ok(): NasActionResult {
  return { ok: true }
}

export function fail(error: string): NasActionResult {
  return { ok: false, error }
}

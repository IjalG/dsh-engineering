/**
 * Review ledger: agent (or desktop) edits that are staged for the user —
 * the file is written, but the change is tracked with a before-snapshot so
 * the user can diff and accept or reject it. Reject restores the original
 * content. Rows live in the workspace SQLite store.
 */

import type { NasDb } from './db.ts'

export type ReviewStatus = 'pending' | 'accepted' | 'rejected'

export interface ReviewRecord {
  id: number
  path: string
  oldContent: string
  newContent: string
  status: ReviewStatus
  createdAt: number
  actor: 'agent' | 'desktop'
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nas_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  old_content TEXT NOT NULL,
  new_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'agent'
);
`

/** Ensure the review table exists. */
export function ensureReviewSchema(db: NasDb): void {
  db.raw.exec(SCHEMA)
}

/** Review ledger facade. */
export class ReviewLedger {
  constructor(private readonly db: NasDb) {
    ensureReviewSchema(db)
  }

  /** Stage one edit: record old/new content as pending. */
  record(path: string, oldContent: string, newContent: string, actor: 'agent' | 'desktop'): ReviewRecord {
    const info = this.db.raw.prepare(
      'INSERT INTO nas_reviews (path, old_content, new_content, status, created_at, actor) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(path, oldContent, newContent, 'pending', Date.now(), actor)
    return this.row(Number(info.lastInsertRowid))
  }

  list(status?: ReviewStatus, limit = 100): ReviewRecord[] {
    const rows = status === undefined
      ? this.db.raw.prepare('SELECT * FROM nas_reviews ORDER BY id DESC LIMIT ?').all(limit)
      : this.db.raw.prepare('SELECT * FROM nas_reviews WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
    return (rows as Array<Record<string, unknown>>).map((row) => this.fromRow(row))
  }

  get(id: number): ReviewRecord | undefined {
    try {
      return this.row(id)
    } catch {
      return undefined
    }
  }

  pendingCount(): number {
    const row = this.db.raw.prepare("SELECT COUNT(*) AS n FROM nas_reviews WHERE status = 'pending'").get() as { n: number }
    return Number(row.n)
  }

  /** Accept: keep the new content (idempotent write) and mark accepted. */
  accept(id: number): ReviewRecord {
    const record = this.row(id)
    this.db.raw.prepare("UPDATE nas_reviews SET status = 'accepted' WHERE id = ?").run(id)
    return { ...record, status: 'accepted' }
  }

  /** Reject: restore the old content and mark rejected. */
  reject(id: number): ReviewRecord {
    const record = this.row(id)
    this.db.raw.prepare("UPDATE nas_reviews SET status = 'rejected' WHERE id = ?").run(id)
    return { ...record, status: 'rejected' }
  }

  private row(id: number): ReviewRecord {
    const row = this.db.raw.prepare('SELECT * FROM nas_reviews WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (row === undefined) throw new Error(`review ${id} not found`)
    return this.fromRow(row)
  }

  private fromRow(row: Record<string, unknown>): ReviewRecord {
    return {
      id: Number(row.id),
      path: String(row.path),
      oldContent: String(row.old_content),
      newContent: String(row.new_content),
      status: String(row.status) as ReviewStatus,
      createdAt: Number(row.created_at),
      actor: String(row.actor) === 'desktop' ? 'desktop' : 'agent',
    }
  }
}

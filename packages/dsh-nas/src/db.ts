/**
 * Workspace-bound SQLite store (.nas/nas.db): full-text index (FTS5 with
 * CJK bigram tokenization), schedule rows, and the notification ledger.
 * One database per workspace root; opened lazily per request.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

/** Schema statements applied on first open. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS nas_files (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ext TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS nas_fts USING fts5(path UNINDEXED, content);
CREATE TABLE IF NOT EXISTS nas_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  action_type TEXT NOT NULL DEFAULT 'notify',
  action_target TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nas_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  response TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

/** One open database handle. */
export interface NasDb {
  readonly path: string
  readonly raw: Database.Database
}

const open = new Map<string, NasDb>()

/** Get (or open) the database for one workspace root. */
export function dbFor(root: string): NasDb {
  const existing = open.get(root)
  if (existing !== undefined) return existing
  const dir = join(root, '.nas')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'nas.db')
  const raw = new Database(path)
  raw.pragma('journal_mode = WAL')
  raw.exec(SCHEMA)
  const handle: NasDb = { path, raw }
  open.set(root, handle)
  return handle
}

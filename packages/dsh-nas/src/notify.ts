/**
 * Webhook notification ledger: at-least-once delivery with idempotency keys,
 * exponential backoff, and a running/succeeded/failed/uncertain state
 * machine (mirrors the OAgent notification design). The ledger lives in the
 * workspace SQLite store.
 */

import type { NasDb } from './db.ts'

/** Max backoff wait (24h, ms). */
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000
/** Base backoff seconds (configurable per call). */
const DEFAULT_BACKOFF_SECONDS = 5

export type NotificationStatus = 'pending' | 'sending' | 'succeeded' | 'failed' | 'uncertain'

export interface NotificationRow {
  id: number
  ruleId: string
  eventType: string
  idempotencyKey: string
  status: NotificationStatus
  attempts: number
  nextAttempt: number
  response?: string
  error?: string
  createdAt: number
  updatedAt: number
}

/** Webhook sender (injectable for tests). */
export type WebhookSender = (url: string, payload: unknown) => Promise<{ ok: boolean; status: number; body: string }>

/** Default sender: plain fetch with a 10s timeout. */
export async function defaultSender(url: string, payload: unknown): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': String((payload as { key?: string })?.key ?? '') },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const body = await response.text()
    return { ok: response.ok, status: response.status, body: body.slice(0, 2000) }
  } finally {
    clearTimeout(timer)
  }
}

/** Notification ledger + delivery driver. */
export class Notifier {
  constructor(
    private readonly db: NasDb,
    private readonly send: WebhookSender = defaultSender,
  ) {}

  /**
   * Enqueue (or replay) one notification. Returns the ledger row. When the
   * same idempotency key already succeeded, the saved result is replayed.
   */
  enqueue(ruleId: string, eventType: string, idempotencyKey: string): NotificationRow {
    const existing = this.db.raw.prepare('SELECT * FROM nas_notifications WHERE idempotency_key = ?').get(idempotencyKey) as
      { id: number } | undefined
    if (existing !== undefined) return this.row(existing.id)
    const now = Date.now()
    const info = this.db.raw.prepare(
      'INSERT INTO nas_notifications (rule_id, event_type, idempotency_key, status, next_attempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(ruleId, eventType, idempotencyKey, 'pending', now, now, now)
    return this.row(Number(info.lastInsertRowid))
  }

  /** Deliver one notification (or replay a succeeded one). */
  async deliver(rowId: number, url: string, payload: unknown): Promise<NotificationRow> {
    const row = this.row(rowId)
    if (row.status === 'succeeded') return row
    if (row.status === 'uncertain') return row
    this.set(rowId, { status: 'sending', attempts: row.attempts + 1, updatedAt: Date.now() })
    try {
      const body = { ...(typeof payload === 'object' && payload !== null ? payload : {}), key: row.idempotencyKey }
      const result = await this.send(url, body)
      if (result.ok) {
        return this.set(rowId, { status: 'succeeded', response: `HTTP ${result.status}`, updatedAt: Date.now() })
      }
      // Server answered with an error: retryable (failed).
      const next = this.nextAttemptMs(row.attempts + 1)
      return this.set(rowId, { status: 'failed', error: `HTTP ${result.status}: ${result.body.slice(0, 200)}`, nextAttempt: next, updatedAt: Date.now() })
    } catch (error) {
      // Network-level failure: send was attempted; outcome unknown -> uncertain.
      const message = error instanceof Error ? error.message : String(error)
      const next = this.nextAttemptMs(row.attempts + 1)
      return this.set(rowId, { status: 'uncertain', error: message, nextAttempt: next, updatedAt: Date.now() })
    }
  }

  /** Retry a failed/uncertain notification now (manual). */
  retry(rowId: number): NotificationRow {
    return this.set(rowId, { status: 'pending', nextAttempt: 0, updatedAt: Date.now() })
  }

  /** Resolve an uncertain notification by human verdict. */
  resolve(rowId: number, verdict: 'succeeded' | 'failed'): NotificationRow {
    return this.set(rowId, { status: verdict, updatedAt: Date.now() })
  }

  /** Rows due for delivery (status pending/uncertain with next_attempt <= now). */
  due(): NotificationRow[] {
    const rows = this.db.raw.prepare(
      "SELECT * FROM nas_notifications WHERE status IN ('pending', 'uncertain') AND next_attempt <= ? ORDER BY created_at LIMIT 50",
    ).all(Date.now()) as Array<Record<string, unknown>>
    return rows.map((row) => this.fromRow(row))
  }

  list(limit = 50): NotificationRow[] {
    const rows = this.db.raw.prepare('SELECT * FROM nas_notifications ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>
    return rows.map((row) => this.fromRow(row))
  }

  private row(id: number): NotificationRow {
    const row = this.db.raw.prepare('SELECT * FROM nas_notifications WHERE id = ?').get(id) as Record<string, unknown>
    if (row === undefined) throw new Error(`notification ${id} not found`)
    return this.fromRow(row)
  }

  private fromRow(row: Record<string, unknown>): NotificationRow {
    return {
      id: Number(row.id),
      ruleId: String(row.rule_id),
      eventType: String(row.event_type),
      idempotencyKey: String(row.idempotency_key),
      status: String(row.status) as NotificationStatus,
      attempts: Number(row.attempts),
      nextAttempt: Number(row.next_attempt),
      response: row.response === null ? undefined : String(row.response),
      error: row.error === null ? undefined : String(row.error),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  /** camelCase patch keys -> snake_case columns. */
  private static readonly COLUMNS: Record<string, string> = {
    ruleId: 'rule_id', eventType: 'event_type', idempotencyKey: 'idempotency_key',
    status: 'status', attempts: 'attempts', nextAttempt: 'next_attempt',
    response: 'response', error: 'error', createdAt: 'created_at', updatedAt: 'updated_at',
  }

  private set(id: number, patch: Partial<Record<string, unknown>>): NotificationRow {
    const entries = Object.entries(patch)
      .filter(([key]) => Notifier.COLUMNS[key] !== undefined)
      .map(([key, value]) => [Notifier.COLUMNS[key], value] as const)
    if (entries.length === 0) return this.row(id)
    const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
    this.db.raw.prepare(`UPDATE nas_notifications SET ${assignments} WHERE id = ?`).run(...entries.map(([, value]) => value), id)
    return this.row(id)
  }

  private nextAttemptMs(attempts: number): number {
    return Date.now() + Math.min(DEFAULT_BACKOFF_SECONDS * 1000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
  }
}

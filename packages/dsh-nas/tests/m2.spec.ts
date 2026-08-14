/**
 * M2 unit tests: CJK bigram tokenization, FTS query building, search index
 * over a temp workspace, notification ledger state machine, scheduler CRUD.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dbFor } from '../src/db.ts'
import { bigramize, matchExpression, SearchIndex } from '../src/search.ts'
import { Notifier, type WebhookSender } from '../src/notify.ts'
import { TaskScheduler, validCron } from '../src/scheduler.ts'
import { ReviewLedger } from '../src/review.ts'

let tmp: string
let root: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dsh-nas-m2-'))
  root = join(tmp, 'ws')
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('CJK bigram tokenization', () => {
  it('splits CJK runs into 2-grams', () => {
    expect(bigramize('合同管理')).toBe('合同 同管 管理')
  })

  it('keeps latin words intact', () => {
    expect(bigramize('hello world')).toBe('hello world')
  })

  it('mixes CJK and latin', () => {
    const grams = bigramize('周报2026').split(/\s+/)
    expect(grams).toContain('周报')
    expect(grams).toContain('报2')
  })

  it('builds an AND match expression', () => {
    expect(matchExpression('合同管理')).toContain('"合同"')
    expect(matchExpression('合同管理')).toContain('"管理"')
    expect(matchExpression('')).toBe('')
  })
})

describe('SearchIndex', () => {
  it('indexes text files and finds CJK queries', () => {
    const db = dbFor(root)
    const index = new SearchIndex(db)
    writeFileSync(join(root, 'report.md'), '本月合同管理完成度 95%')
    writeFileSync(join(root, 'notes.txt'), 'random shopping list')
    index.upsert('report.md', root)
    index.upsert('notes.txt', root)

    const hits = index.query('合同')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.path).toBe('report.md')

    const english = index.query('shopping')
    expect(english.length).toBe(1)
    expect(english[0]?.path).toBe('notes.txt')
  })

  it('removes files from the index', () => {
    const db = dbFor(root)
    const index = new SearchIndex(db)
    writeFileSync(join(root, 'a.md'), 'unique needle here')
    index.upsert('a.md', root)
    expect(index.query('needle').length).toBe(1)
    index.remove('a.md')
    expect(index.query('needle').length).toBe(0)
  })

  it('rescans a directory tree', () => {
    const db = dbFor(root)
    const index = new SearchIndex(db)
    mkdirSync(join(root, 'sub'), { recursive: true })
    writeFileSync(join(root, 'sub', 'b.txt'), 'rescan target word')
    index.rescan(root)
    expect(index.query('rescan').length).toBe(1)
  })

  it('handles non-text files by name', () => {
    const db = dbFor(root)
    const index = new SearchIndex(db)
    writeFileSync(join(root, 'photo.png'), '\u0000binary')
    index.upsert('photo.png', root)
    expect(index.query('photo').length).toBe(1)
  })
})

describe('Notifier ledger', () => {
  it('replays a succeeded delivery by idempotency key', async () => {
    const db = dbFor(root)
    let calls = 0
    const sender: WebhookSender = async () => { calls++; return { ok: true, status: 200, body: 'ok' } }
    const notifier = new Notifier(db, sender)
    const row = notifier.enqueue('rule', 'event', 'key-1')
    const delivered = await notifier.deliver(row.id, 'http://example.test', {})
    expect(delivered.status).toBe('succeeded')
    await notifier.deliver(row.id, 'http://example.test', {})
    expect(calls).toBe(1)
  })

  it('marks network failure as uncertain with a backoff', async () => {
    const db = dbFor(root)
    const sender: WebhookSender = async () => { throw new Error('ECONNREFUSED') }
    const notifier = new Notifier(db, sender)
    const row = notifier.enqueue('rule', 'event', 'key-2')
    const delivered = await notifier.deliver(row.id, 'http://example.test', {})
    expect(delivered.status).toBe('uncertain')
    expect(delivered.nextAttempt).toBeGreaterThan(Date.now())
  })

  it('marks HTTP errors as failed and allows retry', async () => {
    const db = dbFor(root)
    const sender: WebhookSender = async () => ({ ok: false, status: 500, body: 'boom' })
    const notifier = new Notifier(db, sender)
    const row = notifier.enqueue('rule', 'event', 'key-3')
    const delivered = await notifier.deliver(row.id, 'http://example.test', {})
    expect(delivered.status).toBe('failed')
    const retried = notifier.retry(row.id)
    expect(retried.status).toBe('pending')
  })

  it('resolves uncertain by human verdict', async () => {
    const db = dbFor(root)
    const notifier = new Notifier(db, async () => { throw new Error('x') })
    const row = notifier.enqueue('r', 'e', 'key-4')
    await notifier.deliver(row.id, 'http://example.test', {})
    const resolved = notifier.resolve(row.id, 'succeeded')
    expect(resolved.status).toBe('succeeded')
  })
})

describe('TaskScheduler', () => {
  it('validates cron expressions', () => {
    expect(validCron('0 9 * * *')).toBe(true)
    expect(validCron('0 9 * *')).toBe(false)
    expect(validCron('bad')).toBe(false)
  })

  it('creates, lists and removes tasks', () => {
    const db = dbFor(root)
    const scheduler = new TaskScheduler(db, root, async () => {})
    const task = scheduler.create('daily report', '0 9 * * *', 'log', '')
    expect(task.enabled).toBe(true)
    expect(scheduler.list().length).toBe(1)
    expect(scheduler.remove(task.id)).toBe(true)
    expect(scheduler.list().length).toBe(0)
  })

  it('toggles tasks on and off', () => {
    const db = dbFor(root)
    const scheduler = new TaskScheduler(db, root, async () => {})
    const task = scheduler.create('nightly', '0 23 * * *', 'log', '')
    const off = scheduler.toggle(task.id, false)
    expect(off.enabled).toBe(false)
    const on = scheduler.toggle(task.id, true)
    expect(on.enabled).toBe(true)
  })
})

describe('Review ledger', () => {
  it('stages, accepts and rejects edits', () => {
    const db = dbFor(root)
    const ledger = new ReviewLedger(db)
    const record = ledger.record('a.txt', 'old', 'new', 'agent')
    expect(record.status).toBe('pending')
    expect(ledger.pendingCount()).toBe(1)

    const accepted = ledger.accept(record.id)
    expect(accepted.status).toBe('accepted')
    expect(ledger.pendingCount()).toBe(0)

    const second = ledger.record('b.txt', 'x', 'y', 'agent')
    ledger.reject(second.id)
    expect(ledger.get(second.id)?.status).toBe('rejected')
  })

  it('lists pending only when asked', () => {
    const db = dbFor(root)
    const ledger = new ReviewLedger(db)
    ledger.record('a.txt', '1', '2', 'agent')
    ledger.record('b.txt', '1', '2', 'agent')
    const done = ledger.record('c.txt', '1', '2', 'agent')
    ledger.accept(done.id)
    expect(ledger.list('pending').length).toBe(2)
    expect(ledger.list().length).toBe(3)
  })
})

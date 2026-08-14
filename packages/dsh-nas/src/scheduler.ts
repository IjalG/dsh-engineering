/**
 * Scheduled tasks: node-cron over the workspace SQLite store. Each task is a
 * cron expression plus an action (notify -> webhook POST with task context,
 * or log -> append a line to .nas/scheduler.log). The scheduler registers
 * enabled tasks on boot and reloads on CRUD.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import cron from 'node-cron'
import type { NasDb } from './db.ts'

export interface ScheduleRow {
  id: number
  name: string
  cron: string
  actionType: 'notify' | 'log'
  actionTarget: string
  enabled: boolean
  createdAt: number
}

export interface ScheduleTask {
  id: number
  name: string
  cron: string
  actionType: 'notify' | 'log'
  actionTarget: string
  enabled: boolean
  createdAt: number
}

/** Cron expression guard (5 fields). */
export function validCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return cron.validate(parts.join(' '))
}

/** Scheduler facade. */
export class TaskScheduler {
  private readonly handles = new Map<number, cron.ScheduledTask>()

  constructor(
    private readonly db: NasDb,
    private readonly root: string,
    private readonly onNotify: (task: ScheduleTask) => Promise<void> | void,
  ) {}

  /** Register all enabled tasks. */
  start(): void {
    this.stop()
    for (const task of this.list()) {
      if (!task.enabled) continue
      this.arm(task)
    }
  }

  /** Stop every running schedule. */
  stop(): void {
    for (const handle of this.handles.values()) {
      try { handle.stop() } catch { /* best effort */ }
    }
    this.handles.clear()
  }

  list(): ScheduleTask[] {
    const rows = this.db.raw.prepare('SELECT * FROM nas_schedules ORDER BY id').all() as Array<Record<string, unknown>>
    return rows.map((row) => this.fromRow(row))
  }

  create(name: string, expr: string, actionType: string, actionTarget: string): ScheduleTask {
    if (!validCron(expr)) throw new Error(`invalid cron expression: ${expr}`)
    const type = actionType === 'notify' || actionType === 'log' ? actionType : 'log'
    const info = this.db.raw.prepare(
      'INSERT INTO nas_schedules (name, cron, action_type, action_target, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    ).run(name.trim(), expr.trim(), type, actionTarget, Date.now())
    const task = this.list().find((item) => item.id === Number(info.lastInsertRowid))
    if (task === undefined) throw new Error('schedule creation failed')
    this.arm(task)
    return task
  }

  remove(id: number): boolean {
    const handle = this.handles.get(id)
    if (handle !== undefined) {
      try { handle.stop() } catch { /* best effort */ }
      this.handles.delete(id)
    }
    const info = this.db.raw.prepare('DELETE FROM nas_schedules WHERE id = ?').run(id)
    return info.changes > 0
  }

  toggle(id: number, enabled: boolean): ScheduleTask {
    this.db.raw.prepare('UPDATE nas_schedules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
    const task = this.list().find((item) => item.id === id)
    if (task === undefined) throw new Error(`schedule ${id} not found`)
    const handle = this.handles.get(id)
    if (handle !== undefined) {
      try { handle.stop() } catch { /* best effort */ }
      this.handles.delete(id)
    }
    if (task.enabled) this.arm(task)
    return task
  }

  /** Fire one task immediately (manual trigger). */
  async fire(task: ScheduleTask): Promise<void> {
    if (task.actionType === 'log') {
      this.log(task, `manual trigger ${new Date().toISOString()}`)
      return
    }
    await this.onNotify(task)
  }

  private arm(task: ScheduleTask): void {
    try {
      const handle = cron.schedule(task.cron, () => {
        void (async () => {
          if (task.actionType === 'log') {
            this.log(task, `fired at ${new Date().toISOString()}`)
            return
          }
          await this.onNotify(task)
        })()
      })
      this.handles.set(task.id, handle)
    } catch {
      // invalid expression despite validation -> skip
    }
  }

  private log(task: ScheduleTask, message: string): void {
    try {
      const dir = join(this.root, '.nas')
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, 'scheduler.log'), `[${new Date().toISOString()}] ${task.name}: ${message}\n`)
    } catch {
      // best effort
    }
  }

  private fromRow(row: Record<string, unknown>): ScheduleTask {
    return {
      id: Number(row.id),
      name: String(row.name),
      cron: String(row.cron),
      actionType: String(row.action_type) === 'notify' ? 'notify' : 'log',
      actionTarget: String(row.action_target),
      enabled: Number(row.enabled) === 1,
      createdAt: Number(row.created_at),
    }
  }
}

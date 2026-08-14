/**
 * Browser-side API for the /api/dsh-nas route family. Plain fetch against
 * the same-origin webServer endpoints; every call carries the current
 * sessionId so the host resolves the right workspace root.
 */

import type {
  NasActionResult, NasAppMeta, NasFsListResult, NasPrefs, NasReadResult, NasTrashEntry,
} from '../protocol.ts'
import type { ScheduleTask } from '../scheduler.ts'
import type { NotificationRow } from '../notify.ts'
import type { SearchHit } from '../search.ts'
import { NAS_API_PREFIX } from '../protocol.ts'

/** Resolve the active session id (best effort; host falls back without it). */
export function currentSessionId(): string | undefined {
  try {
    // The shell stores the active session on the document element.
    const element = document.querySelector<HTMLElement>('[data-session-id]')
    return element?.dataset.sessionId
  } catch {
    return undefined
  }
}

/** One call to a NAS endpoint. */
async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${NAS_API_PREFIX}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, sessionId: currentSessionId() }),
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const parsed = await response.json() as { error?: string }
      if (typeof parsed.error === 'string') message = parsed.error
    } catch {
      // keep status message
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

/** Filesystem + trash + apps + prefs facade. */
export class NasApi {
  list(path = ''): Promise<NasFsListResult> {
    return call('fs.list', { path })
  }

  read(path: string, maxBytes?: number): Promise<NasReadResult> {
    return call('fs.read', { path, ...(maxBytes !== undefined ? { maxBytes } : {}) })
  }

  write(path: string, content: string): Promise<NasActionResult> {
    return call('fs.write', { path, content })
  }

  mkdir(path: string): Promise<NasActionResult> {
    return call('fs.mkdir', { path })
  }

  move(src: string, dest: string): Promise<NasActionResult> {
    return call('fs.move', { src, dest })
  }

  copy(src: string, dest: string): Promise<NasActionResult> {
    return call('fs.copy', { src, dest })
  }

  delete(path: string): Promise<NasActionResult> {
    return call('fs.delete', { path })
  }

  trashList(): Promise<{ ok: boolean; items: NasTrashEntry[] }> {
    return call('trash.list')
  }

  trashRestore(id: string): Promise<NasActionResult> {
    return call('trash.restore', { id })
  }

  trashEmpty(): Promise<NasActionResult> {
    return call('trash.empty')
  }

  appsList(): Promise<{ ok: boolean; apps: NasAppMeta[] }> {
    return call('apps.list')
  }

  prefsGet(): Promise<{ ok: boolean; prefs: NasPrefs }> {
    return call('prefs.get')
  }

  prefsSet(prefs: NasPrefs): Promise<NasActionResult> {
    return call('prefs.set', { prefs })
  }

  search(query: string, limit?: number): Promise<{ ok: boolean; hits: SearchHit[] }> {
    return call('search.query', { query, ...(limit !== undefined ? { limit } : {}) })
  }

  scheduleList(): Promise<{ ok: boolean; tasks: ScheduleTask[] }> {
    return call('schedule.list')
  }

  scheduleCreate(name: string, cron: string, actionType: string, actionTarget: string): Promise<NasActionResult & { task?: ScheduleTask }> {
    return call('schedule.create', { name, cron, actionType, actionTarget })
  }

  scheduleRemove(id: number): Promise<NasActionResult> {
    return call('schedule.remove', { id: String(id) })
  }

  scheduleToggle(id: number, enabled: boolean): Promise<{ ok: boolean; task?: ScheduleTask; error?: string }> {
    return call('schedule.toggle', { id: String(id), enabled })
  }

  scheduleFire(id: number): Promise<NasActionResult> {
    return call('schedule.fire', { id: String(id) })
  }

  notifyList(): Promise<{ ok: boolean; items: NotificationRow[] }> {
    return call('notify.list')
  }

  notifyRetry(id: number): Promise<{ ok: boolean; error?: string }> {
    return call('notify.retry', { id: String(id) })
  }

  notifyResolve(id: number, verdict: 'succeeded' | 'failed'): Promise<{ ok: boolean; error?: string }> {
    return call('notify.resolve', { id: String(id), verdict })
  }

  reviewList(): Promise<{ ok: boolean; items: Array<{ id: number; path: string; status: string; createdAt: number; actor: string }> }> {
    return call('review.list')
  }

  reviewDiff(id: number): Promise<{ ok: boolean; record?: { id: number; path: string; oldContent: string; newContent: string; status: string; createdAt: number; actor: string }; error?: string }> {
    return call('review.diff', { id: String(id) })
  }

  reviewAccept(id: number): Promise<{ ok: boolean; error?: string }> {
    return call('review.accept', { id: String(id) })
  }

  reviewReject(id: number): Promise<{ ok: boolean; error?: string }> {
    return call('review.reject', { id: String(id) })
  }
}

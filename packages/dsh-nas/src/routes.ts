/**
 * The /api/dsh-nas route family: filesystem, trash, apps and prefs for the
 * browser desktop. The webServer matches paths EXACTLY (no path parameters),
 * so action targets travel in the JSON body. Every route carries the
 * loopback-only trust fence (these endpoints mutate workspace files).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { fail, ok } from './audit.ts'
import type { AppRegistry } from './apps.ts'
import type { FsApi } from './fsapi.ts'
import type { NasPrefs } from './protocol.ts'
import { NAS_API_PREFIX, type NasPrefsSetPayload } from './protocol.ts'

/** Cap on JSON request bodies (all NAS payloads are small). */
const MAX_JSON_BODY_BYTES = 512 * 1024

/** Loopback literal check plus browser same-origin markers (mirrors dsh-ssh's fence). */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Read and parse a small JSON body, or respond 400. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_JSON_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  return JSON.parse(raw) as unknown
}

/** Write a JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** Extract a string field from an unknown body. */
function str(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/** Extract sessionId (optional) from a body. */
function sessionOf(body: unknown): string | undefined {
  return str(body, 'sessionId')
}

/** Handler context bundle. */
export interface NasRouteContext {
  fs: FsApi
  apps: AppRegistry
  getPrefs: () => NasPrefs
  setPrefs: (prefs: NasPrefs) => void
  /** Read the live plugin config (master switch). */
  getConfig: () => { enabled?: boolean; announceToAgent?: boolean }
  /** Persist a config patch through the settings service. */
  updateConfig: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
}

/** One route factory: exact path, loopback fence, JSON body, JSON reply. */
function handle(action: string, run: (body: unknown, res: ServerResponse) => Promise<void> | void): WebRoute {
  return {
    kind: 'exact',
    path: `${NAS_API_PREFIX}/${action}`,
    handler: async (request, response) => {
      if (!isLoopbackRequest(request)) {
        json(response, 403, fail('loopback only'))
        return
      }
      if (request.method !== 'POST') {
        json(response, 405, fail('POST only'))
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch (error) {
        json(response, 400, fail(error instanceof Error ? error.message : 'bad body'))
        return
      }
      try {
        await run(body, response)
      } catch (error) {
        json(response, 400, fail(error instanceof Error ? error.message : String(error)))
      }
    },
  }
}

/** Build the /api/dsh-nas route family. */
export function makeRoutes(ctx: NasRouteContext): WebRoute[] {
  return [...managementRoutes(ctx), ...dataRoutes(ctx)]
}

/**
 * Routes that survive the master switch (management surface): the panel
 * needs them to show state and to turn the system back on. Everything that
 * touches the filesystem (data routes) is unregistered while disabled.
 */
export function managementRoutes(ctx: NasRouteContext): WebRoute[] {
  return [
    handle('apps.list', (_body, res) => {
      json(res, 200, { ok: true, apps: ctx.apps.list() })
    }),
    handle('settings.get', (_body, res) => {
      json(res, 200, { ok: true, config: ctx.getConfig() })
    }),
    handle('settings.set', async (body, res) => {
      if (typeof body !== 'object' || body === null) { json(res, 400, fail('patch required')); return }
      const patch = (body as Record<string, unknown>).patch
      if (typeof patch !== 'object' || patch === null) { json(res, 400, fail('patch required')); return }
      const outcome = await ctx.updateConfig(patch as Record<string, unknown>)
      json(res, outcome.ok ? 200 : 400, outcome)
    }),
  ]
}

/** Filesystem-touching routes, registered only while the system is enabled. */
export function dataRoutes(ctx: NasRouteContext): WebRoute[] {
  return [
    handle('fs.list', (body, res) => {
      json(res, 200, ctx.fs.list(str(body, 'path') ?? '', sessionOf(body)))
    }),
    handle('fs.read', (body, res) => {
      const path = str(body, 'path')
      if (path === undefined) { json(res, 400, fail('path required')); return }
      const maxBytes = typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).maxBytes === 'number'
        ? (body as Record<string, unknown>).maxBytes as number
        : undefined
      json(res, 200, ctx.fs.read(path, maxBytes, sessionOf(body)))
    }),
    handle('fs.write', (body, res) => {
      const path = str(body, 'path')
      const content = str(body, 'content')
      if (path === undefined || content === undefined) { json(res, 400, fail('path and content required')); return }
      json(res, 200, ctx.fs.write(path, content, sessionOf(body)))
    }),
    handle('fs.mkdir', (body, res) => {
      const path = str(body, 'path')
      if (path === undefined) { json(res, 400, fail('path required')); return }
      json(res, 200, ctx.fs.mkdir(path, sessionOf(body)))
    }),
    handle('fs.move', (body, res) => {
      const src = str(body, 'src')
      const dest = str(body, 'dest')
      if (src === undefined || dest === undefined) { json(res, 400, fail('src and dest required')); return }
      json(res, 200, ctx.fs.move(src, dest, sessionOf(body)))
    }),
    handle('fs.copy', (body, res) => {
      const src = str(body, 'src')
      const dest = str(body, 'dest')
      if (src === undefined || dest === undefined) { json(res, 400, fail('src and dest required')); return }
      json(res, 200, ctx.fs.copy(src, dest, sessionOf(body)))
    }),
    handle('fs.delete', (body, res) => {
      const path = str(body, 'path')
      if (path === undefined) { json(res, 400, fail('path required')); return }
      json(res, 200, ctx.fs.delete(path, sessionOf(body)))
    }),
    handle('trash.list', (body, res) => {
      json(res, 200, { ok: true, items: ctx.fs.trashItems(sessionOf(body)) })
    }),
    handle('trash.restore', (body, res) => {
      const id = str(body, 'id')
      if (id === undefined) { json(res, 400, fail('id required')); return }
      json(res, 200, ctx.fs.restore(id, sessionOf(body)))
    }),
    handle('trash.empty', (_body, res) => {
      json(res, 200, ctx.fs.emptyTrash(sessionOf(_body)))
    }),
    handle('prefs.get', (_body, res) => {
      json(res, 200, { ok: true, prefs: ctx.getPrefs() })
    }),
    handle('prefs.set', (body, res) => {
      if (typeof body !== 'object' || body === null) { json(res, 400, fail('prefs required')); return }
      const prefs = (body as NasPrefsSetPayload).prefs
      if (typeof prefs !== 'object' || prefs === null) { json(res, 400, fail('prefs required')); return }
      ctx.setPrefs(prefs)
      json(res, 200, ok())
    }),
  ]
}

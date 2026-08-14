/**
 * dsh-mail — host half (software package for the dsh-nas desktop).
 *
 * Registers the Mail app into nas.apps and serves /api/dsh-mail: inbox
 * listing/reading, sending (mock-first), and config (credentials in
 * ~/.dsh/dsh-mail.json, 0600). The browser half registers the window.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { MailEngine, readMailConfig, writeMailConfig, type MailConfig, type SendRequest } from './mail.ts'

/** Stable cordis plugin name. */
export const name = 'dsh-mail'

/** Services required before the surfaces can mount. */
export const inject = ['webServer']

/** API prefix. */
const API = '/api/dsh-mail'

const APP_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 5l5.5 4 5.5-4"/></svg>'

function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  try {
    const hostUrl = new URL(`http://${host}`)
    if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  } catch {
    return false
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === new URL(`http://${host}`).host
  } catch {
    return false
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > 4 * 1024 * 1024) throw new Error('body too large')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  return JSON.parse(raw) as unknown
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function str(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function sessionOf(body: unknown): string | undefined {
  return str(body, 'sessionId')
}

/** Resolve a workspace-relative path safely. */
function resolveInside(root: string, rel: string): string | undefined {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 4096) return undefined
  if (isAbsolute(rel)) return undefined
  const resolved = resolve(root, rel)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (resolved !== root && !resolved.startsWith(prefix)) return undefined
  if (resolved.slice(prefix.length).split(sep)[0] === '.nas') return undefined
  return resolved
}

function makeRootResolver(ctx: Context): (sessionId?: string) => string {
  return (sessionId?: string): string => {
    if (sessionId !== undefined) {
      try {
        const session = ctx.get('sessions')?.get(sessionId as SessionId)
        const cwd = session?.header.cwd
        if (typeof cwd === 'string' && cwd.length > 0) return cwd
      } catch {
        // fall through
      }
    }
    try {
      const workspaceRoot = ctx.get('sandboxPolicy')?.workspaceRoot
      if (typeof workspaceRoot === 'string' && workspaceRoot.length > 0) return workspaceRoot
    } catch {
      // fall through
    }
    return process.cwd()
  }
}

/** Plugin entry. */
export function apply(ctx: Context): void {
  const resolveRoot = makeRootResolver(ctx)

  // Register into the nas desktop (delayed: loader applies rows concurrently).
  const loose = ctx as unknown as { get(name: string): unknown }
  let attempts = 0
  const tryRegister = (): void => {
    try {
      const apps = loose.get('nas.apps') as { register(app: { id: string; name: string; icon: string; fileExts: string[]; windowKind: string; packageName: string; description?: string }): () => void } | undefined
      if (apps !== undefined) {
        apps.register({
          id: 'mail',
          name: 'Mail',
          icon: APP_ICON,
          fileExts: ['eml'],
          windowKind: 'mail',
          packageName: '@linxin666/dsh-mail',
          description: '邮箱：收件/阅读/发送',
        })
        return
      }
    } catch (error) {
      console.warn('[dsh-mail] nas.apps registration failed:', error)
      return
    }
    if (++attempts < 30) setTimeout(tryRegister, 100)
  }
  tryRegister()

  const route = (action: string, run: (body: unknown, res: ServerResponse) => Promise<void> | void): WebRoute => ({
    kind: 'exact',
    path: `${API}/${action}`,
    handler: async (request, response) => {
      if (!isLoopbackRequest(request)) { json(response, 403, { ok: false, error: 'loopback only' }); return }
      if (request.method !== 'POST') { json(response, 405, { ok: false, error: 'POST only' }); return }
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch (error) {
        json(response, 400, { ok: false, error: error instanceof Error ? error.message : 'bad body' })
        return
      }
      try {
        await run(body, response)
      } catch (error) {
        json(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  const engineFor = (root: string): MailEngine => new MailEngine(root, readMailConfig())

  const routes: WebRoute[] = [
    route('config.get', (_body, res) => {
      const config = readMailConfig()
      json(res, 200, {
        ok: true,
        config: {
          mock: config.mock !== false,
          smtpHost: config.smtpHost ?? '',
          smtpPort: config.smtpPort ?? 587,
          imapHost: config.imapHost ?? '',
          imapPort: config.imapPort ?? 993,
          fromName: config.fromName ?? '',
          fromAddress: config.fromAddress ?? '',
          // never echo passwords
        },
      })
    }),
    route('config.set', (body, res) => {
      const read = (key: string): string | undefined => str(body, key)
      const num = (key: string): number | undefined => {
        const value = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined
        return typeof value === 'number' ? value : undefined
      }
      const existing = readMailConfig()
      const next: MailConfig = {
        mock: read('mock') !== 'false',
        smtpHost: read('smtpHost') ?? existing.smtpHost,
        smtpPort: num('smtpPort') ?? existing.smtpPort,
        smtpUser: read('smtpUser') ?? existing.smtpUser,
        smtpPass: read('smtpPass') ?? existing.smtpPass,
        imapHost: read('imapHost') ?? existing.imapHost,
        imapPort: num('imapPort') ?? existing.imapPort,
        imapUser: read('imapUser') ?? existing.imapUser,
        imapPass: read('imapPass') ?? existing.imapPass,
        fromName: read('fromName') ?? existing.fromName,
        fromAddress: read('fromAddress') ?? existing.fromAddress,
      }
      writeMailConfig(next)
      json(res, 200, { ok: true })
    }),
    route('inbox.list', async (body, res) => {
      const root = resolveRoot(sessionOf(body))
      const items = await engineFor(root).listInbox(50)
      json(res, 200, { ok: true, items, mock: readMailConfig().mock !== false })
    }),
    route('message.read', async (body, res) => {
      const uid = Number(str(body, 'uid'))
      if (!Number.isFinite(uid)) { json(res, 400, { ok: false, error: 'uid required' }); return }
      const root = resolveRoot(sessionOf(body))
      const message = await engineFor(root).readMessage(uid)
      if (message === undefined) { json(res, 404, { ok: false, error: 'message not found' }); return }
      json(res, 200, { ok: true, message })
    }),
    route('send', async (body, res) => {
      const to = str(body, 'to') ?? ''
      const subject = str(body, 'subject') ?? ''
      const text = str(body, 'body') ?? ''
      if (to === '') { json(res, 400, { ok: false, error: 'to required' }); return }
      const root = resolveRoot(sessionOf(body))
      const request: SendRequest = { to, subject, body: text }
      const outcome = await engineFor(root).send(request)
      json(res, outcome.ok ? 200 : 400, outcome)
    }),
  ]

  for (const r of routes) {
    ctx.webServer.register(r)
  }
}

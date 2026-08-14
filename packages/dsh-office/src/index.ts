/**
 * dsh-office — host half (software package for the dsh-nas desktop).
 *
 * Registers the Office app into the nas.apps registry (host side) and serves
 * the /api/dsh-office route family: Word (docx<->HTML), Excel (xlsx<->JSON
 * grids), PDF merge/split, LibreOffice conversion to PDF, and OCR through a
 * user-configured vision endpoint. The browser half registers the window
 * renderers via the nasClient service.
 *
 * Everything rides official NPM SDK packages — no dsh source changes.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isAbsolute, join, resolve, sep } from 'node:path'
import {
  convertToPdf, docxToHtml, gridsToXlsx, htmlToDocx, mergePdfs, probeLibreOffice, splitPdf, xlsxToGrids,
} from './docs.ts'
import { imageToBase64, readOfficeConfig, visionOcr, writeOfficeConfig, type OfficeConfig } from './ocr.ts'

/** Stable cordis plugin name. */
export const name = 'dsh-office'

/** Services required before the surfaces can mount. */
export const inject = ['webServer']

/** API prefix. */
const API = '/api/dsh-office'

/** App metadata registered into the nas desktop (id/windowKind/icon). */
const APP_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 5.5h6M5 8h6M5 10.5h4"/></svg>'

/** Loopback fence (mirrors dsh-ssh / dsh-nas). */
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

/** JSON body reader (bounded — office payloads can carry HTML/grids). */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > 8 * 1024 * 1024) throw new Error('body too large')
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

/** Resolve a workspace-relative path safely (same rules as dsh-nas). */
export function resolveInside(root: string, rel: string): string | undefined {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 4096) return undefined
  if (isAbsolute(rel)) return undefined
  const resolved = resolve(root, rel)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (resolved !== root && !resolved.startsWith(prefix)) return undefined
  if (resolved.slice(prefix.length).split(sep)[0] === '.nas') return undefined
  return resolved
}

/** Root resolver: session cwd -> sandbox root -> process cwd. */
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

  // Register into the nas desktop (host-side app registry; the browser half
  // registers the window renderer through nasClient). The loader applies
  // plugin rows concurrently, so the nas.apps service may not exist yet —
  // retry briefly instead of hard-injecting (dsh-nas absent must degrade,
  // not block).
  const loose = ctx as unknown as { get(name: string): unknown }
  let attempts = 0
  const tryRegister = (): void => {
    try {
      const apps = loose.get('nas.apps') as { register(app: { id: string; name: string; icon: string; fileExts: string[]; windowKind: string; packageName: string; description?: string }): () => void } | undefined
      if (apps !== undefined) {
        apps.register({
          id: 'office',
          name: 'Office',
          icon: APP_ICON,
          fileExts: ['docx', 'xlsx', 'pptx', 'pdf'],
          windowKind: 'office',
          packageName: '@linxin666/dsh-office',
          description: 'Word / Excel / PPT / PDF 预览与编辑',
        })
        return
      }
    } catch (error) {
      console.warn('[dsh-office] nas.apps registration failed:', error)
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

  const routes: WebRoute[] = [
    route('probe', async (_body, res) => {
      json(res, 200, { ok: true, libreOffice: await probeLibreOffice() })
    }),
    route('word.open', async (body, res) => {
      const path = str(body, 'path')
      if (path === undefined) { json(res, 400, { ok: false, error: 'path required' }); return }
      const root = resolveRoot(sessionOf(body))
      const filePath = resolveInside(root, path)
      if (filePath === undefined) { json(res, 400, { ok: false, error: 'path outside workspace' }); return }
      json(res, 200, { ok: true, ...(await docxToHtml(filePath)) })
    }),
    route('word.save', async (body, res) => {
      const path = str(body, 'path')
      const html = str(body, 'html')
      if (path === undefined || html === undefined) { json(res, 400, { ok: false, error: 'path and html required' }); return }
      const root = resolveRoot(sessionOf(body))
      const filePath = resolveInside(root, path)
      if (filePath === undefined) { json(res, 400, { ok: false, error: 'path outside workspace' }); return }
      await htmlToDocx(html, filePath)
      json(res, 200, { ok: true })
    }),
    route('sheet.open', async (body, res) => {
      const path = str(body, 'path')
      if (path === undefined) { json(res, 400, { ok: false, error: 'path required' }); return }
      const root = resolveRoot(sessionOf(body))
      const filePath = resolveInside(root, path)
      if (filePath === undefined) { json(res, 400, { ok: false, error: 'path outside workspace' }); return }
      json(res, 200, { ok: true, grids: await xlsxToGrids(filePath) })
    }),
    route('sheet.save', async (body, res) => {
      const path = str(body, 'path')
      const grids = (body as { grids?: unknown }).grids
      if (path === undefined || !Array.isArray(grids)) { json(res, 400, { ok: false, error: 'path and grids required' }); return }
      const root = resolveRoot(sessionOf(body))
      const filePath = resolveInside(root, path)
      if (filePath === undefined) { json(res, 400, { ok: false, error: 'path outside workspace' }); return }
      await gridsToXlsx(grids as Array<{ name: string; rows: string[][] }>, filePath)
      json(res, 200, { ok: true })
    }),
    route('pdf.merge', async (body, res) => {
      const paths = (body as { paths?: unknown }).paths
      const outPath = str(body, 'outPath')
      if (!Array.isArray(paths) || paths.length < 2 || outPath === undefined) { json(res, 400, { ok: false, error: 'paths and outPath required' }); return }
      const root = resolveRoot(sessionOf(body))
      const files: string[] = []
      for (const p of paths) {
        if (typeof p !== 'string') continue
        const filePath = resolveInside(root, p)
        if (filePath !== undefined) files.push(filePath)
      }
      if (files.length < 2) { json(res, 400, { ok: false, error: 'need at least two valid pdfs' }); return }
      const out = resolveInside(root, outPath)
      if (out === undefined) { json(res, 400, { ok: false, error: 'outPath outside workspace' }); return }
      const pages = await mergePdfs(files, out)
      json(res, 200, { ok: true, pages, outPath })
    }),
    route('pdf.split', async (body, res) => {
      const path = str(body, 'path')
      if (path === undefined) { json(res, 400, { ok: false, error: 'path required' }); return }
      const root = resolveRoot(sessionOf(body))
      const filePath = resolveInside(root, path)
      if (filePath === undefined) { json(res, 400, { ok: false, error: 'path outside workspace' }); return }
      const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
      const outRel = `${base}split`
      const outDir = resolveInside(root, outRel)
      if (outDir === undefined) { json(res, 400, { ok: false, error: 'output outside workspace' }); return }
      const created = await splitPdf(filePath, outDir)
      json(res, 200, { ok: true, files: created.map((f) => f.slice(root.length + 1)) })
    }),
    route('convert', async (body, res) => {
      const path = str(body, 'path')
      if (path === undefined) { json(res, 400, { ok: false, error: 'path required' }); return }
      const root = resolveRoot(sessionOf(body))
      const filePath = resolveInside(root, path)
      if (filePath === undefined) { json(res, 400, { ok: false, error: 'path outside workspace' }); return }
      const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
      const outRel = `${base}pdf`
      const outDir = resolveInside(root, outRel)
      if (outDir === undefined) { json(res, 400, { ok: false, error: 'output outside workspace' }); return }
      const out = await convertToPdf(filePath, outDir)
      json(res, 200, { ok: true, outPath: out.slice(root.length + 1) })
    }),
    route('ocr.image', async (body, res) => {
      const path = str(body, 'path')
      if (path === undefined) { json(res, 400, { ok: false, error: 'path required' }); return }
      const root = resolveRoot(sessionOf(body))
      const filePath = resolveInside(root, path)
      if (filePath === undefined) { json(res, 400, { ok: false, error: 'path outside workspace' }); return }
      const config = await readOfficeConfig()
      const { base64, mime } = await imageToBase64(filePath)
      const page = await visionOcr(config, base64, mime, 1)
      json(res, 200, { ok: true, page, untrusted: true, model: config.visionModel, configured: config.visionEndpoint !== undefined })
    }),
    route('config.get', async (_body, res) => {
      const config = await readOfficeConfig()
      json(res, 200, {
        ok: true,
        config: {
          visionEndpoint: config.visionEndpoint ?? '',
          visionModel: config.visionModel ?? '',
          visionConfigured: config.visionEndpoint !== undefined && config.visionKey !== undefined,
        },
      })
    }),
    route('config.set', async (body, res) => {
      const endpoint = str(body, 'visionEndpoint') ?? ''
      const key = str(body, 'visionKey') ?? ''
      const model = str(body, 'visionModel') ?? ''
      const config: OfficeConfig = {}
      if (endpoint !== '') config.visionEndpoint = endpoint
      if (key !== '') config.visionKey = key
      if (model !== '') config.visionModel = model
      await writeOfficeConfig(config)
      json(res, 200, { ok: true })
    }),
  ]

  for (const r of routes) {
    ctx.webServer.register(r)
  }
}

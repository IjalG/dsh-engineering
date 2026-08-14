/**
 * Browser API for /api/dsh-office.
 */

import type { SheetGrid, SlideText } from '../docs.ts'
import type { OcrPage } from '../ocr.ts'

let ACTIVE_SESSION: string | undefined

/** The desktop feeds the active session id through the window props. */
export function setOfficeSessionId(sessionId: string | undefined): void {
  ACTIVE_SESSION = sessionId
}

/** Resolve the active session id (best effort). */
export function currentSessionId(): string | undefined {
  if (ACTIVE_SESSION !== undefined && ACTIVE_SESSION !== '') return ACTIVE_SESSION
  try {
    return document.querySelector<HTMLElement>('[data-session-id]')?.dataset.sessionId
  } catch {
    return undefined
  }
}

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/dsh-office/${action}`, {
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
      // keep status
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export interface WordOpenResult { ok: boolean; html: string; title: string; error?: string }
export interface SheetOpenResult { ok: boolean; grids: SheetGrid[]; error?: string }
export interface OcrResult { ok: boolean; page: OcrPage; untrusted: boolean; model?: string; configured: boolean; error?: string }
export interface ProbeResult { ok: boolean; libreOffice: { available: boolean; version?: string } }

/** Office API facade. */
export class OfficeApi {
  probe(): Promise<ProbeResult> { return call('probe') }
  wordOpen(path: string): Promise<WordOpenResult> { return call('word.open', { path }) }
  wordSave(path: string, html: string): Promise<{ ok: boolean; error?: string }> { return call('word.save', { path, html }) }
  sheetOpen(path: string): Promise<SheetOpenResult> { return call('sheet.open', { path }) }
  sheetSave(path: string, grids: SheetGrid[]): Promise<{ ok: boolean; error?: string }> { return call('sheet.save', { path, grids }) }
  pdfMerge(paths: string[], outPath: string): Promise<{ ok: boolean; pages?: number; error?: string }> { return call('pdf.merge', { paths, outPath }) }
  pdfSplit(path: string): Promise<{ ok: boolean; files?: string[]; error?: string }> { return call('pdf.split', { path }) }
  convert(path: string): Promise<{ ok: boolean; outPath?: string; error?: string }> { return call('convert', { path }) }
  pptOpen(path: string): Promise<{ ok: boolean; slides: SlideText[]; error?: string }> { return call('ppt.open', { path }) }
  pptSave(path: string, slides: SlideText[]): Promise<{ ok: boolean; error?: string }> { return call('ppt.save', { path, slides }) }
  pdfPages(path: string): Promise<{ ok: boolean; pages: Array<{ page: number; base64: string; mime: string }>; count?: number; error?: string }> { return call('pdf.pages', { path }) }
  ocrImage(path: string): Promise<OcrResult> { return call('ocr.image', { path }) }
  ocrPdf(path: string): Promise<{ ok: boolean; pages?: Array<{ page: number; text: string; method: string; error?: string }>; error?: string; untrusted?: boolean }> { return call('ocr.pdf', { path }) }
  configGet(): Promise<{ ok: boolean; config: { visionEndpoint: string; visionModel: string; visionConfigured: boolean } }> { return call('config.get') }
  configSet(visionEndpoint: string, visionKey: string, visionModel: string): Promise<{ ok: boolean; error?: string }> { return call('config.set', { visionEndpoint, visionKey, visionModel }) }
}

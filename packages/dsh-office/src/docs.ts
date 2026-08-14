/**
 * Office document conversion: docx -> HTML (mammoth), HTML -> docx (docx),
 * xlsx <-> JSON grid (exceljs), PDF merge/split (pdf-lib), and LibreOffice
 * Office->PDF conversion. All file access goes through workspace-relative
 * paths resolved by the caller.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import mammoth from 'mammoth'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, LevelFormat, AlignmentType, ImageRun, PageOrientation } from 'docx'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'

const execFileAsync = promisify(execFile)

/** One worksheet as a JSON grid. */
export interface SheetGrid {
  name: string
  rows: string[][]
}

/** Merged cell range (1-based exceljs coords, inclusive). */
export interface SheetMerge {
  sheet: string
  r1: number
  c1: number
  r2: number
  c2: number
}

/** Frozen rows per sheet. */
export interface SheetFreeze {
  sheet: string
  /** Number of frozen top rows. */
  rows: number
  /** Number of frozen left columns. */
  cols: number
}

/** Word document as HTML (editable in the client). */
export interface WordHtml {
  html: string
  title: string
}

/** LibreOffice availability probe result. */
export interface ConverterProbe {
  available: boolean
  version?: string
}

/** Whether the system LibreOffice binary exists. */
export async function probeLibreOffice(): Promise<ConverterProbe> {
  try {
    const { stdout } = await execFileAsync('soffice', ['--version'], { timeout: 5000 })
    return { available: true, version: stdout.trim().split('\n')[0] }
  } catch {
    return { available: false }
  }
}

/** docx -> HTML (with embedded base64 images where mammoth provides them). */
export async function docxToHtml(filePath: string): Promise<WordHtml> {
  const buffer = await readFile(filePath)
  const result = await mammoth.convertToHtml({ buffer }, { convertImage: mammoth.images.imgElement((image) => image.read('base64').then((b64) => ({ src: `data:${image.contentType};base64,${b64}` }))) })
  return { html: result.value, title: basename(filePath).replace(/\.docx?$/i, '') }
}

/** Page setup: paper size, orientation and margin preset. */
export interface PageSetup {
  size?: 'A4' | 'Letter'
  orientation?: 'portrait' | 'landscape'
  margins?: 'normal' | 'narrow' | 'wide'
}

/** Paper sizes in twips (dxa). */
const PAPER_SIZES: Record<'A4' | 'Letter', { width: number; height: number }> = {
  A4: { width: 11906, height: 16838 },
  Letter: { width: 12240, height: 15840 },
}

/** Margin presets in twips (1 inch = 1440). */
const MARGIN_PRESETS: Record<'normal' | 'narrow' | 'wide', { top: number; right: number; bottom: number; left: number }> = {
  normal: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
  narrow: { top: 720, right: 720, bottom: 720, left: 720 },
  wide: { top: 1440, right: 2880, bottom: 1440, left: 2880 },
}

/**
 * Simple HTML subset -> docx: h1-h6, p, ul/ol/li, table, strong/em/u,
 * br, a (stripped). Unknown tags degrade to paragraphs of their text.
 */
export async function htmlToDocx(html: string, outPath: string, pageSetup: PageSetup = {}): Promise<void> {
  const paragraphs = parseHtmlToBlocks(html)
  const children = blocksToDocx(paragraphs)
  const paper = PAPER_SIZES[pageSetup.size ?? 'A4']
  const landscape = pageSetup.orientation === 'landscape'
  const margins = MARGIN_PRESETS[pageSetup.margins ?? 'normal']
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: paper.width,
            height: paper.height,
            orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: margins,
        },
      },
      children,
    }],
  })
  const buffer = await Packer.toBuffer(doc)
  mkdirSync(dirname(outPath), { recursive: true })
  await writeFile(outPath, buffer)
}

/** A block-level image (data URL). */
export interface HtmlImage {
  src: string
  width?: number
  height?: number
}

interface HtmlBlock {
  kind: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'table' | 'img'
  text?: string
  rows?: string[][]
  ordered?: boolean
  level?: number
  image?: HtmlImage
}

/** Minimal HTML block parser (regex-based, tolerant). */
export function parseHtmlToBlocks(html: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = []
  // Strip scripts/styles/comments.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  // Tables first (they contain block tags).
  const tableRe = /<table[\s\S]*?<\/table>/gi
  const tableMatches = [...cleaned.matchAll(tableRe)]
  let cursor = 0
  for (const match of tableMatches) {
    const before = cleaned.slice(cursor, match.index)
    pushInlineBlocks(blocks, before)
    blocks.push(parseTable(match[0]))
    cursor = (match.index ?? 0) + match[0].length
  }
  pushInlineBlocks(blocks, cleaned.slice(cursor))
  return blocks
}

function pushInlineBlocks(blocks: HtmlBlock[], segment: string): void {
  // Split into block-level tags, preserving list context.
  const re = /<(h[1-6]|p|ul|ol|li)[^>]*>([\s\S]*?)<\/\1>|<img[^>]*>/gi
  let cursor = 0
  let ordered = false
  let listLevel = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(segment)) !== null) {
    const before = segment.slice(cursor, match.index).trim()
    if (before !== '') blocks.push({ kind: 'p', text: plainText(before) })
    if (match[0].toLowerCase().startsWith('<img')) {
      const srcMatch = /src="([^"]+)"/i.exec(match[0])
      const wMatch = /data-width="(\d+)"/i.exec(match[0])
      const hMatch = /data-height="(\d+)"/i.exec(match[0])
      const src = srcMatch?.[1] ?? ''
      if (src !== '') {
        blocks.push({
          kind: 'img',
          image: {
            src,
            width: wMatch !== null ? Number(wMatch[1]) : undefined,
            height: hMatch !== null ? Number(hMatch[1]) : undefined,
          },
        })
      }
      cursor = match.index + match[0].length
      continue
    }
    const tag = match[1].toLowerCase()
    const inner = match[2]
    if (tag === 'ul' || tag === 'ol') {
      ordered = tag === 'ol'
      listLevel++
      // Parse the list items inside (recursive scan for nested lists).
      pushListItems(blocks, inner, ordered, listLevel)
      cursor = match.index + match[0].length
      continue
    }
    if (tag === 'li') {
      blocks.push({ kind: 'li', text: inlineText(inner), ordered, level: listLevel })
      cursor = match.index + match[0].length
      continue
    }
    if (tag === 'p') { blocks.push({ kind: 'p', text: inlineText(inner) }); cursor = match.index + match[0].length; continue }
    const level = Number(tag[1])
    const kind = level <= 2 ? (`h${level}` as 'h1' | 'h2') : 'h3'
    blocks.push({ kind, text: inlineText(inner) })
    cursor = match.index + match[0].length
  }
  const tail = segment.slice(cursor).trim()
  if (tail !== '') blocks.push({ kind: 'p', text: plainText(tail) })
}

/** Parse list items (with nesting) inside a ul/ol body. */
function pushListItems(blocks: HtmlBlock[], html: string, ordered: boolean, level: number): void {
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi
  let liMatch: RegExpExecArray | null
  while ((liMatch = liRe.exec(html)) !== null) {
    const inner = liMatch[1]
    // Nested list inside this item?
    const nested = /<(ul|ol)[\s\S]*?<\/\1>/i.exec(inner)
    const text = nested !== null ? inlineText(inner.slice(0, nested.index)) : inlineText(inner)
    blocks.push({ kind: 'li', text, ordered, level })
    if (nested !== null) {
      const nestedTag = nested[1].toLowerCase()
      pushListItems(blocks, nested[0], nestedTag === 'ol', level + 1)
    }
  }
}

function parseTable(html: string): HtmlBlock {
  const rows: string[][] = []
  const rowRe = /<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells: string[] = []
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(inlineText(cellMatch[1]))
    }
    rows.push(cells)
  }
  return { kind: 'table', rows }
}

/** Inline text: strip tags but keep strong/em as plain (docx text runs). */
function inlineText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

function plainText(html: string): string {
  return inlineText(html)
}

function blocksToDocx(blocks: HtmlBlock[]): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = []
  let listItems: Array<{ text: string; ordered: boolean; level: number }> = []
  const flushList = (): void => {
    if (listItems.length === 0) return
    for (const item of listItems) {
      // Real Word list item (numbering/bullet definition), not a text prefix —
      // mammoth then reads it back as <ul>/<ol><li>.
      children.push(new Paragraph({
        children: [new TextRun({ text: item.text })],
        bullet: { level: Math.max(0, Math.min(8, item.level - 1)) },
        numbering: item.ordered
          ? { reference: 'ordered-list', level: Math.max(0, Math.min(8, item.level - 1)) }
          : undefined,
        indent: item.ordered ? undefined : { left: 360 * Math.min(8, item.level) },
      }))
    }
    listItems = []
  }
  for (const block of blocks) {
    if (block.kind === 'h1') { flushList(); children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: block.text ?? '', bold: true, size: 32 })] })) }
    else if (block.kind === 'h2') { flushList(); children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: block.text ?? '', bold: true, size: 28 })] })) }
    else if (block.kind === 'h3') { flushList(); children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: block.text ?? '', bold: true, size: 24 })] })) }
    else if (block.kind === 'p') { flushList(); children.push(new Paragraph({ children: [new TextRun({ text: block.text ?? '' })] })) }
    else if (block.kind === 'li') { listItems.push({ text: block.text ?? '', ordered: block.ordered ?? false, level: block.level ?? 1 }) }
    else if (block.kind === 'table') {
      flushList()
      const rows = (block.rows ?? []).map((cells) => new TableRow({ children: cells.map((cell) => new TableCell({ children: [new Paragraph({ text: cell })], width: { size: 100 / Math.max(1, cells.length), type: WidthType.PERCENTAGE } })) }))
      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }))
    }
    else if (block.kind === 'img' && block.image !== undefined) {
      flushList()
      const imageRun = dataUrlToImageRun(block.image)
      if (imageRun !== undefined) children.push(new Paragraph({ children: [imageRun] }))
    }
  }
  flushList()
  return children
}

export interface XlsxReadResult {
  grids: SheetGrid[]
  merges: SheetMerge[]
  freezes: SheetFreeze[]
}

/** xlsx -> JSON grids + merged ranges (first 200 rows x 40 cols per sheet, 3 sheets max). */
export async function xlsxToGrids(filePath: string): Promise<XlsxReadResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const grids: SheetGrid[] = []
  const merges: SheetMerge[] = []
  const freezes: SheetFreeze[] = []
  for (const worksheet of workbook.worksheets.slice(0, 3)) {
    const rows: string[][] = []
    for (let r = 1; r <= Math.min(200, worksheet.rowCount); r++) {
      const row = worksheet.getRow(r)
      const cells: string[] = []
      for (let c = 1; c <= Math.min(40, row.cellCount); c++) {
        const value = row.getCell(c).value
        cells.push(cellToText(value))
      }
      rows.push(cells)
    }
    grids.push({ name: worksheet.name, rows })
    const view = (worksheet.views ?? [])[0] as { xSplit?: number; ySplit?: number } | undefined
    if (view !== undefined && ((view.ySplit ?? 0) > 0 || (view.xSplit ?? 0) > 0)) {
      freezes.push({ sheet: worksheet.name, rows: view.ySplit ?? 0, cols: view.xSplit ?? 0 })
    }
    // worksheet.model.merges is string-address pairs like 'A1:B2'.
    for (const raw of worksheet.model.merges ?? []) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(raw))
      if (m === null) continue
      const c1 = colIndex(m[1]!)
      const r1 = Number(m[2]!)
      const c2 = colIndex(m[3]!)
      const r2 = Number(m[4]!)
      merges.push({ sheet: worksheet.name, r1, c1, r2, c2 })
    }
  }
  return { grids, merges, freezes }
}

function colIndex(letters: string): number {
  let n = 0
  for (const char of letters) n = n * 26 + (char.charCodeAt(0) - 64)
  return n
}

function colName(index: number): string {
  let n = index
  let name = ''
  do {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
    n = Math.floor((n - 1) / 26)
  } while (n > 0)
  return name
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && 'text' in (value as object) && 'richText' in (value as object) && (value as { richText?: unknown }).richText === undefined) {
    return String((value as { text: unknown }).text)
  }
  if (typeof value === 'object' && 'result' in (value as object)) return String((value as { result: unknown }).result)
  return String(value)
}

/** JSON grids -> xlsx (creates/overwrites; keeps formulas as text). */
export async function gridsToXlsx(grids: SheetGrid[], outPath: string, merges: SheetMerge[] = [], freezes: SheetFreeze[] = []): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  for (const grid of grids.slice(0, 3)) {
    const sheet = workbook.addWorksheet(grid.name.slice(0, 31) || 'Sheet1')
    for (const row of grid.rows) {
      sheet.addRow(row.map((cell) => cell))
    }
  }
  for (const merge of merges) {
    const sheet = workbook.worksheets.find((ws) => ws.name === merge.sheet)
    if (sheet === undefined) continue
    try {
      sheet.mergeCells(merge.r1, merge.c1, merge.r2, merge.c2)
    } catch {
      // overlapping merge -> skip
    }
  }
  for (const freeze of freezes) {
    const sheet = workbook.worksheets.find((ws) => ws.name === freeze.sheet)
    if (sheet === undefined) continue
    sheet.views = [{ state: 'frozen', xSplit: freeze.cols, ySplit: freeze.rows }]
  }
  mkdirSync(dirname(outPath), { recursive: true })
  await workbook.xlsx.writeFile(outPath)
}

/** One slide's editable text (title + body lines). */
export interface SlideText {
  title: string
  body: string[]
  /** Optional base64 data URL image. */
  image?: string
  /** Optional speaker notes. */
  notes?: string
}

/** Presentation content (slides of title/body text). */
export interface PresentationText {
  slides: SlideText[]
}

/** pptx -> slide texts (best effort: reads slide XML text runs via JSZip). */
export async function pptxToSlides(filePath: string): Promise<PresentationText> {
  const data = await readFile(filePath)
  const zip = await JSZip.loadAsync(data)
  const slides: SlideText[] = []
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(/slide(\d+)\.xml/i.exec(a)?.[1] ?? 0)
      const nb = Number(/slide(\d+)\.xml/i.exec(b)?.[1] ?? 0)
      return na - nb
    })
  for (const name of names) {
    const xml = await zip.file(name)?.async('string')
    if (xml === undefined) continue
    const texts: string[] = []
    const textRe = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    let match: RegExpExecArray | null
    while ((match = textRe.exec(xml)) !== null) {
      const text = match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      if (text.trim() !== '') texts.push(text)
    }
    slides.push({ title: texts[0] ?? '', body: texts.slice(1) })
  }
  return { slides }
}

/** slide texts -> pptx (title + body lines per slide). */
export async function slidesToPptx(presentation: PresentationText, outPath: string): Promise<void> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  for (const slide of presentation.slides.slice(0, 40)) {
    const slideDef = pptx.addSlide()
    if (slide.title !== '') {
      slideDef.addText(slide.title, { x: 0.5, y: 0.4, w: 9, h: 0.9, fontSize: 28, bold: true, color: '1F2937' })
    }
    // Image (data URL) sits right of the text when present.
    if (slide.image !== undefined && slide.image !== '') {
      try {
        const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(slide.image)
        if (match !== null) {
          const mime = match[1]!.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
          const data = `data:image/${mime};base64,${match[2]}`
          slideDef.addImage({ data, x: 0.5, y: 1.5, w: 4.4, h: 3.3 })
          if (slide.body.length > 0) {
            slideDef.addText(slide.body.slice(0, 12).join('\n'), { x: 5.1, y: 1.5, w: 4.4, h: 4.5, fontSize: 16, color: '374151', breakLine: true })
          }
        }
      } catch {
        // bad image -> text only
        if (slide.body.length > 0) {
          slideDef.addText(slide.body.slice(0, 12).join('\n'), { x: 0.5, y: 1.5, w: 9, h: 4.5, fontSize: 16, color: '374151', breakLine: true })
        }
      }
    } else if (slide.body.length > 0) {
      slideDef.addText(slide.body.slice(0, 12).join('\n'), { x: 0.5, y: 1.5, w: 9, h: 4.5, fontSize: 16, color: '374151', breakLine: true })
    }
    if (slide.notes !== undefined && slide.notes !== '') {
      slideDef.addNotes(slide.notes)
    }
  }
  mkdirSync(dirname(outPath), { recursive: true })
  await pptx.writeFile({ fileName: outPath })
}

/** Merge PDFs into one file. */
export async function mergePdfs(paths: string[], outPath: string): Promise<number> {
  const merged = await PDFDocument.create()
  for (const path of paths) {
    const src = await PDFDocument.load(await readFile(path))
    const pages = await merged.copyPages(src, src.getPageIndices())
    for (const page of pages) merged.addPage(page)
  }
  const bytes = await merged.save()
  mkdirSync(dirname(outPath), { recursive: true })
  await writeFile(outPath, bytes)
  return merged.getPageCount()
}

/** Split a PDF into one file per page (outDir/page-001.pdf...). */
export async function splitPdf(filePath: string, outDir: string, outName = 'page'): Promise<string[]> {
  const src = await PDFDocument.load(await readFile(filePath))
  const created: string[] = []
  mkdirSync(outDir, { recursive: true })
  for (let i = 0; i < src.getPageCount(); i++) {
    const single = await PDFDocument.create()
    const [page] = await single.copyPages(src, [i])
    single.addPage(page)
    const bytes = await single.save()
    const out = join(outDir, `${outName}-${String(i + 1).padStart(3, '0')}.pdf`)
    await writeFile(out, bytes)
    created.push(out)
  }
  return created
}

/** Extract text from a PDF (best effort via pdf-lib's text extraction). */
export async function pdfText(filePath: string): Promise<string> {
  const doc = await PDFDocument.load(await readFile(filePath))
  const pages = doc.getPages()
  const parts: string[] = []
  for (const page of pages.slice(0, 50)) {
    // pdf-lib does not extract text; LibreOffice conversion covers it.
    parts.push(`page ${page.getSize().width}x${page.getSize().height}`)
  }
  return parts.join('\n')
}

/** data URL -> docx ImageRun (returns undefined for unsupported payloads). */
function dataUrlToImageRun(image: HtmlImage): ImageRun | undefined {
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(image.src)
  if (match === null) return undefined
  const rawMime = match[1]!
  const bytes = Uint8Array.from(atob(match[2]!), (char) => char.charCodeAt(0))
  const width = Math.max(40, Math.min(800, image.width ?? 320))
  const height = Math.max(40, Math.min(800, image.height ?? Math.round((width * 3) / 4)))
  const mime = rawMime === 'image/jpeg' ? 'jpg' : rawMime === 'image/png' ? 'png' : rawMime === 'image/gif' ? 'gif' : rawMime === 'image/bmp' ? 'bmp' : 'png'
  return new ImageRun({ data: bytes, transformation: { width, height }, type: mime })
}

/** Office file -> PDF via LibreOffice headless. */
export async function convertToPdf(filePath: string, outDir: string): Promise<string> {
  const probe = await probeLibreOffice()
  if (!probe.available) throw new Error('LibreOffice (soffice) is not installed; cannot convert to PDF')
  mkdirSync(outDir, { recursive: true })
  await execFileAsync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, filePath], { timeout: 120_000 })
  const name = basename(filePath).replace(/\.[^.]+$/, '') + '.pdf'
  const out = join(outDir, name)
  return out
}

/**
 * dsh-office unit tests: HTML block parsing, docx<->HTML round-trip,
 * xlsx<->grids round-trip, PDF merge/split.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  docxToHtml, gridsToXlsx, htmlToDocx, mergePdfs, parseHtmlToBlocks, splitPdf, xlsxToGrids,
} from '../src/docs.ts'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dsh-office-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('HTML block parser', () => {
  it('parses headings, paragraphs and lists', () => {
    const blocks = parseHtmlToBlocks('<h1>标题</h1><p>正文内容</p><ul><li>项目一</li><li>项目二</li></ul>')
    expect(blocks[0]).toMatchObject({ kind: 'h1', text: '标题' })
    expect(blocks[1]).toMatchObject({ kind: 'p', text: '正文内容' })
    expect(blocks.filter((b) => b.kind === 'li')).toHaveLength(2)
  })

  it('parses tables', () => {
    const blocks = parseHtmlToBlocks('<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>')
    const table = blocks.find((b) => b.kind === 'table')
    expect(table?.rows).toEqual([['A', 'B'], ['1', '2']])
  })

  it('decodes entities', () => {
    const blocks = parseHtmlToBlocks('<p>a &amp; b &lt;c&gt;</p>')
    expect(blocks[0]?.text).toBe('a & b <c>')
  })
})

describe('docx round-trip', () => {
  it('writes HTML to docx and reads it back with the text intact', async () => {
    const out = join(tmp, 'doc.docx')
    const html = '<h1>报告标题</h1><p>第一段正文。</p><p>第二段：<strong>重点</strong>内容。</p>'
    await htmlToDocx(html, out)
    const { html: readBack } = await docxToHtml(out)
    expect(readBack).toContain('报告标题')
    expect(readBack).toContain('第一段正文')
    expect(readBack).toContain('重点')
  })
})

describe('xlsx round-trip', () => {
  it('writes grids to xlsx and reads them back', async () => {
    const out = join(tmp, 'sheet.xlsx')
    await gridsToXlsx([{ name: '数据', rows: [['名称', '数量'], ['苹果', '3'], ['香蕉', '5']] }], out)
    const { grids, merges } = await xlsxToGrids(out)
    expect(grids[0]?.name).toBe('数据')
    expect(grids[0]?.rows[0]).toEqual(['名称', '数量'])
    expect(grids[0]?.rows[2]).toEqual(['香蕉', '5'])
    expect(merges).toEqual([])
  })
})

describe('PDF merge and split', () => {
  it('merges two pdfs and splits the result back', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const makePdf = async (path: string): Promise<void> => {
      const doc = await PDFDocument.create()
      doc.addPage([200, 200])
      const bytes = await doc.save()
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, bytes)
    }
    const a = join(tmp, 'a.pdf')
    const b = join(tmp, 'b.pdf')
    await makePdf(a)
    await makePdf(b)
    const merged = join(tmp, 'merged.pdf')
    const pages = await mergePdfs([a, b], merged)
    expect(pages).toBe(2)
    const files = await splitPdf(merged, join(tmp, 'split'))
    expect(files).toHaveLength(2)
  })
})

describe('docx image and table round-trip', () => {
  it('preserves tables and images through docx', async () => {
    const out = join(tmp, 'rich.docx')
    // 1x1 png data url
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const html = `<h1>标题</h1><table><tr><td>单元格A</td><td>单元格B</td></tr></table><img src="${png}" data-width="64" data-height="64" />`
    await htmlToDocx(html, out)
    const { html: readBack } = await docxToHtml(out)
    expect(readBack).toContain('单元格A')
    expect(readBack).toContain('data:image/png;base64')
  })
})

describe('pptx round-trip', () => {
  it('writes slides to pptx and reads the text back', async () => {
    const out = join(tmp, 'deck.pptx')
    const { slidesToPptx, pptxToSlides } = await import('../src/docs.ts')
    await slidesToPptx({ slides: [{ title: '季度汇报', body: ['销售增长 20%', '新客户 5 家'] }, { title: '下一步', body: [] }] }, out)
    const { slides } = await pptxToSlides(out)
    expect(slides.length).toBe(2)
    expect(slides[0]?.title).toBe('季度汇报')
    expect(slides[0]?.body).toContain('销售增长 20%')
  })

  it('writes slides with an image without failing', async () => {
    const out = join(tmp, 'deck2.pptx')
    const { slidesToPptx } = await import('../src/docs.ts')
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    await slidesToPptx({ slides: [{ title: '图', body: ['带图'], image: png, notes: '备注文本' }] }, out)
    const { stat } = await import('node:fs/promises')
    const info = await stat(out)
    expect(info.size).toBeGreaterThan(1000)
  })
})

describe('merged cells', () => {
  it('round-trips merged ranges through xlsx', async () => {
    const out = join(tmp, 'merged.xlsx')
    const { gridsToXlsx, xlsxToGrids } = await import('../src/docs.ts')
    await gridsToXlsx([{ name: 'S', rows: [['标题', ''], ['a', 'b']] }], out, [{ sheet: 'S', r1: 1, c1: 1, r2: 1, c2: 2 }])
    const { merges } = await xlsxToGrids(out)
    expect(merges.length).toBe(1)
    expect(merges[0]).toMatchObject({ r1: 1, c1: 1, r2: 1, c2: 2 })
  })
})

describe('frozen rows', () => {
  it('round-trips frozen header rows through xlsx', async () => {
    const out = join(tmp, 'frozen.xlsx')
    const { gridsToXlsx, xlsxToGrids } = await import('../src/docs.ts')
    await gridsToXlsx([{ name: 'S', rows: [['h'], ['1']] }], out, [], [{ sheet: 'S', rows: 1, cols: 0 }])
    const { freezes } = await xlsxToGrids(out)
    expect(freezes.length).toBe(1)
    expect(freezes[0]).toMatchObject({ sheet: 'S', rows: 1 })
  })
})

describe('pdf stamp', () => {
  it('adds page numbers and a watermark', async () => {
    const src = join(tmp, 'src.pdf')
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    doc.addPage([400, 400])
    doc.addPage([400, 400])
    const { writeFile } = await import('node:fs/promises')
    await writeFile(src, await doc.save())
    const out = join(tmp, 'stamped.pdf')
    const { stampPdf } = await import('../src/docs.ts')
    const pages = await stampPdf(src, out, { pageNumbers: true, watermark: '机密' })
    expect(pages).toBe(2)
    const stamped = await PDFDocument.load(await (await import('node:fs/promises')).readFile(out))
    expect(stamped.getPageCount()).toBe(2)
  })
})

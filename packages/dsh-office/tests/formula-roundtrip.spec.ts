import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { gridsToXlsx, xlsxToGrids } from '../src/docs.ts'

describe('univer formula roundtrip', () => {
  it('stores =SUM(...) as a real formula and reads it back as text', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'office-rt-')), 'rt.xlsx')
    await gridsToXlsx([{ name: 'S', rows: [['a', '1'], ['b', '2'], ['=SUM(B1:B2)', '合计']] }], out)
    // 1. exceljs sees a real formula object (Excel can compute it)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(out)
    const v = wb.getWorksheet('S')?.getCell('A3').value
    expect(typeof v).toBe('object')
    expect((v as { formula: string }).formula).toBe('SUM(B1:B2)')
    // 2. our reader returns the formula text again (editors round-trip it)
    const { grids } = await xlsxToGrids(out)
    expect(grids[0]?.rows[2]?.[0]).toBe('=SUM(B1:B2)')
    expect(grids[0]?.rows[2]?.[1]).toBe('合计')
  })
  it('keeps numbers and plain text intact', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'office-rt2-')), 'rt.xlsx')
    await gridsToXlsx([{ name: 'S', rows: [['名', '3.5', 'true'], ['', '文本', '']] }], out)
    const { grids } = await xlsxToGrids(out)
    expect(grids[0]?.rows[0]).toEqual(['名', '3.5', 'true'])
    expect(grids[0]?.rows[1]?.[1]).toBe('文本')
  })
})

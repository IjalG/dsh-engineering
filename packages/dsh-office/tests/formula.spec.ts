/**
 * Formula engine tests: hyperformula integration basics — the functions our
 * grid exposes (SUM/AVERAGE/IF/cross-sheet references) must compute correctly.
 */

import { HyperFormula } from 'hyperformula'
import { describe, expect, it } from 'vitest'

describe('hyperformula engine', () => {
  it('computes SUM and AVERAGE over a column', () => {
    const hf = HyperFormula.buildFromSheets(
      { S1: [['1'], ['2'], ['3'], ['=SUM(A1:A3)'], ['=AVERAGE(A1:A3)']] },
      { licenseKey: 'gpl-v3' },
    )
    expect(hf.getCellValue({ sheet: 0, col: 0, row: 3 })).toBe(6)
    expect(hf.getCellValue({ sheet: 0, col: 0, row: 4 })).toBe(2)
  })

  it('computes IF and cross-sheet references', () => {
    const hf = HyperFormula.buildFromSheets(
      {
        Data: [['10'], ['5']],
        Calc: [['=IF(Data!A1>Data!A2, "big", "small")'], ['=Data!A1+Data!A2']],
      },
      { licenseKey: 'gpl-v3' },
    )
    expect(hf.getCellValue({ sheet: 1, col: 0, row: 0 })).toBe('big')
    expect(hf.getCellValue({ sheet: 1, col: 0, row: 1 })).toBe(15)
  })

  it('propagates changes through dependencies', () => {
    const hf = HyperFormula.buildFromSheets(
      { S: [['2'], ['3'], ['=A1*A2']] },
      { licenseKey: 'gpl-v3' },
    )
    expect(hf.getCellValue({ sheet: 0, col: 0, row: 2 })).toBe(6)
    hf.setCellContents({ sheet: 0, col: 0, row: 0 }, [['5']])
    expect(hf.getCellValue({ sheet: 0, col: 0, row: 2 })).toBe(15)
  })

  it('rejects a broken formula without throwing', () => {
    const hf = HyperFormula.buildFromSheets(
      { S: [['=NOTAREALFUNC(1)']] },
      { licenseKey: 'gpl-v3' },
    )
    const value = hf.getCellValue({ sheet: 0, col: 0, row: 0 })
    expect(typeof value).toBe('object') // error object, not a crash
  })
})

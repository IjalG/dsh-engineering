/**
 * Univer spreadsheet: the Apache-2.0 Univer engine (the open-source base of
 * the online-sheet products) provides the full spreadsheet UI — formulas,
 * formats, filters, charts, merged cells, freeze panes. We bridge it to the
 * workspace: open reads an xlsx via exceljs into the workbook; save reads
 * values + formulas back and writes the xlsx via exceljs.
 *
 * Thanks: Univer (Apache-2.0) and its ecosystem.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { LocaleType, Univer, UniverInstanceType } from '@univerjs/core'
// Side-effect: registers the workbook facade methods (getActiveWorkbook).
import '@univerjs/sheets/facade'
import type { FUniver } from '@univerjs/core/facade'
import { defaultTheme } from '@univerjs/themes'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverUIPlugin } from '@univerjs/ui'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt'
import { UniverSheetsZenEditorPlugin } from '@univerjs/sheets-zen-editor'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeKey } from './locales.ts'
import { OfficeApi } from './api.ts'
import { UNIVER_CSS } from './univer-css.gen.ts'
import css from './office.module.css'

export interface UniverSheetAppProps {
  path: string
  t: Translate<OfficeKey>
}

const api = new OfficeApi()

let cssInjected = false
function injectUniverCss(): void {
  if (cssInjected || typeof document === 'undefined') return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-office-univer'
  tag.textContent = UNIVER_CSS
  document.head.appendChild(tag)
  cssInjected = true
}

/** Trim trailing empty rows/columns from a 2D matrix. */
function trimGrid(rows: (string | number | boolean | null | undefined)[][]): string[][] {
  let lastRow = rows.length - 1
  while (lastRow >= 0 && (rows[lastRow] ?? []).every((cell) => cell === undefined || cell === null || cell === '')) lastRow--
  const kept = rows.slice(0, lastRow + 1)
  let lastCol = 0
  for (const row of kept) {
    for (let c = row.length - 1; c >= 0; c--) {
      if (row[c] !== undefined && row[c] !== null && row[c] !== '') { lastCol = Math.max(lastCol, c); break }
    }
  }
  return kept.map((row) => row.slice(0, lastCol + 1).map((cell) => String(cell ?? '')))
}

export function UniverSheetApp({ path, t }: UniverSheetAppProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const univerRef = useRef<{ univer: Univer; api: FUniver } | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | undefined>()

  const mount = useCallback(async (): Promise<void> => {
    if (containerRef.current === null) return
    setError(undefined)
    injectUniverCss()
    // Defensive: dispose any previous instance (React remounts).
    univerRef.current?.univer.dispose()
    univerRef.current = null

    const univer = new Univer({ theme: defaultTheme, locale: LocaleType.EN_US })
    univer.registerPlugin(UniverRenderEnginePlugin)
    univer.registerPlugin(UniverFormulaEnginePlugin)
    univer.registerPlugin(UniverUIPlugin, { container: containerRef.current })
    univer.registerPlugin(UniverSheetsPlugin)
    univer.registerPlugin(UniverSheetsUIPlugin)
    univer.registerPlugin(UniverSheetsNumfmtPlugin)
    univer.registerPlugin(UniverSheetsFormulaPlugin)
    univer.registerPlugin(UniverSheetsZenEditorPlugin)
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {})

    const { FUniver: FUniverClass } = await import('@univerjs/core/facade')
    const apiFacade = FUniverClass.newAPI(univer)
    univerRef.current = { univer, api: apiFacade }

    // Bridge the workspace xlsx into the workbook.
    try {
      const result = await api.sheetOpen(path)
      if (!result.ok) { setError(result.error); return }
      const workbook = apiFacade.getActiveWorkbook()
      if (workbook === null) { setError('workbook init failed'); return }
      let first = true
      for (const grid of result.grids.slice(0, 10)) {
        const sheet = first ? workbook.getActiveSheet() : workbook.insertSheet(grid.name)
        first = false
        if (sheet === null) continue
        if (grid.rows.length === 0) continue
        const colCount = Math.max(1, ...grid.rows.map((row) => row.length))
        sheet.getRange(0, 0, grid.rows.length, colCount).setValues(grid.rows)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [path])

  useEffect(() => {
    void mount()
    return () => {
      univerRef.current?.univer.dispose()
      univerRef.current = null
    }
  }, [mount])

  const save = async (): Promise<void> => {
    const runtime = univerRef.current
    if (runtime === null) return
    setStatus(t('editor.saving'))
    setError(undefined)
    try {
      const workbook = runtime.api.getActiveWorkbook()
      if (workbook === null) { setError('workbook lost'); setStatus(''); return }
      const grids: Array<{ name: string; rows: string[][] }> = []
      for (const sheet of workbook.getSheets()) {
        const name = sheet.getSheetName()
        const maxRows = Math.min(200, sheet.getMaxRows())
        const maxCols = Math.min(40, sheet.getMaxColumns())
        if (maxRows === 0 || maxCols === 0) continue
        const values = sheet.getRange(0, 0, maxRows, maxCols).getValues()
        const formulas = sheet.getRange(0, 0, maxRows, maxCols).getFormulas()
        const rows = trimGrid(values.map((row, r) =>
          row.map((cell, c) => {
            // getFormulas() yields null (or '') where a cell has no formula —
            // keep the displayed value there, the formula string when present.
            const f = formulas[r]?.[c]
            return f !== undefined && f !== null && f !== '' ? f : String(cell ?? '')
          })))
        grids.push({ name, rows })
      }
      const result = await api.sheetSave(path, grids)
      if (!result.ok) { setError(result.error); setStatus('') }
      else { setStatus(t('editor.saved')); setTimeout(() => setStatus(''), 1500) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('')
    }
  }

  return (
    <div className={css.container}>
      <div className={css.toolbar}>
        <span className={css.path}>{path}</span>
        <span className={css.spacer} />
        {status !== '' && <span className={css.status}>{status}</span>}
        <button type="button" className={css.button} onClick={() => void save()}>{t('editor.save')}</button>
      </div>
      {error !== undefined && <div className={css.error}>{error}</div>}
      <div ref={containerRef} className={css.univerHost} />
    </div>
  )
}

/**
 * Excel app: lightweight grid editor bound to a .xlsx file (JSON grids over
 * the host exceljs round-trip).
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeKey } from './locales.ts'
import type { SheetGrid } from '../docs.ts'
import { OfficeApi } from './api.ts'
import css from './office.module.css'

export interface ExcelAppProps {
  path: string
  t: Translate<OfficeKey>
}

const api = new OfficeApi()

const MAX_ROWS = 200
const MAX_COLS = 40

export function ExcelApp({ path, t }: ExcelAppProps): React.ReactElement {
  const [grids, setGrids] = useState<SheetGrid[]>([])
  const [active, setActive] = useState(0)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await api.sheetOpen(path)
      if (!result.ok) { setError(result.error); return }
      if (result.grids.length === 0) result.grids.push({ name: 'Sheet1', rows: [['']] })
      setGrids(result.grids)
      setActive(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => { void load() }, [load])

  const setCell = (row: number, col: number, value: string): void => {
    setGrids((prev) => prev.map((grid, gi) => {
      if (gi !== active) return grid
      const rows = grid.rows.map((r, ri) => (ri === row ? [...r] : [...r]))
      while (rows.length <= row) rows.push([])
      rows[row]![col] = value
      return { ...grid, rows }
    }))
  }

  const addRow = (): void => {
    setGrids((prev) => prev.map((grid, gi) => gi === active && grid.rows.length < MAX_ROWS
      ? { ...grid, rows: [...grid.rows, []] }
      : grid))
  }

  const addCol = (): void => {
    setGrids((prev) => prev.map((grid, gi) => {
      if (gi !== active) return grid
      const rows = grid.rows.map((r) => (r.length < MAX_COLS ? [...r, ''] : r))
      return { ...grid, rows }
    }))
  }

  const save = async (): Promise<void> => {
    setStatus(t('editor.saving'))
    try {
      const result = await api.sheetSave(path, grids)
      if (!result.ok) { setError(result.error); setStatus('') }
      else { setStatus(t('editor.saved')); setTimeout(() => setStatus(''), 1500) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('')
    }
  }

  const grid = grids[active]
  const rowCount = Math.max(1, grid?.rows.length ?? 1)
  const colCount = Math.max(1, ...(grid?.rows.map((r) => r.length) ?? [1]))

  return (
    <div className={css.container}>
      <div className={css.toolbar}>
        {grids.map((gridItem, index) => (
          <button key={gridItem.name} type="button" className={[css.sheetTab, index === active ? css.sheetTabActive : ''].join(' ')} onClick={() => setActive(index)}>
            {gridItem.name}
          </button>
        ))}
        <span className={css.spacer} />
        {status !== '' && <span className={css.status}>{status}</span>}
        <button type="button" className={css.button} onClick={addRow}>{t('sheet.addRow')}</button>
        <button type="button" className={css.button} onClick={addCol}>{t('sheet.addCol')}</button>
        <button type="button" className={css.button} onClick={() => void save()}>{t('editor.save')}</button>
      </div>
      {error !== undefined && <div className={css.error}>{error}</div>}
      {loading && <div className={css.hint}>{t('editor.saving')}</div>}
      {!loading && grid !== undefined && (
        <div className={css.gridScroll}>
          <table className={css.grid}>
            <thead>
              <tr>
                <th className={css.gridCorner} />
                {Array.from({ length: colCount }, (_, c) => <th key={c} className={css.gridHead}>{String.fromCharCode(65 + (c % 26))}{Math.floor(c / 26) > 0 ? Math.floor(c / 26) : ''}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rowCount }, (_, r) => (
                <tr key={r}>
                  <th className={css.gridRowHead}>{r + 1}</th>
                  {Array.from({ length: colCount }, (_, c) => (
                    <td key={c} className={css.gridCell}>
                      <input
                        className={css.gridInput}
                        value={grid.rows[r]?.[c] ?? ''}
                        onChange={(event) => setCell(r, c, event.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

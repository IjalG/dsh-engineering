/**
 * Excel app: grid editor bound to a .xlsx file (JSON grids over the host
 * exceljs round-trip). Row/column insert & delete, column width dragging,
 * sheet add/remove, and cell editing.
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

const MAX_ROWS = 500
const MAX_COLS = 80

/** Column letter for a 0-based index. */
function colLetter(index: number): string {
  let n = index
  let letter = ''
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return letter
}

export function ExcelApp({ path, t }: ExcelAppProps): React.ReactElement {
  const [grids, setGrids] = useState<SheetGrid[]>([])
  const [active, setActive] = useState(0)
  const [colWidths, setColWidths] = useState<number[]>([])
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

  const grid = grids[active]

  const setCell = (row: number, col: number, value: string): void => {
    setGrids((prev) => prev.map((g, gi) => {
      if (gi !== active) return g
      const rows = g.rows.map((r, ri) => (ri === row ? [...r] : [...r]))
      while (rows.length <= row) rows.push([])
      rows[row]![col] = value
      return { ...g, rows }
    }))
  }

  const insertRow = (): void => {
    setGrids((prev) => prev.map((g, gi) => {
      if (gi !== active || g.rows.length >= MAX_ROWS) return g
      const rows = [...g.rows]
      rows.splice(Math.max(0, rows.length - 1), 0, [])
      return { ...g, rows }
    }))
  }

  const insertCol = (): void => {
    setGrids((prev) => prev.map((g, gi) => {
      if (gi !== active) return g
      return { ...g, rows: g.rows.map((r) => (r.length < MAX_COLS ? [...r, ''] : r)) }
    }))
  }

  const deleteRow = (): void => {
    setGrids((prev) => prev.map((g, gi) => {
      if (gi !== active || g.rows.length <= 1) return g
      return { ...g, rows: g.rows.slice(0, -1) }
    }))
  }

  const deleteCol = (): void => {
    setGrids((prev) => prev.map((g, gi) => {
      if (gi !== active) return g
      const width = Math.max(1, ...g.rows.map((r) => r.length))
      if (width <= 1) return g
      return { ...g, rows: g.rows.map((r) => r.slice(0, Math.max(0, r.length - 1))) }
    }))
  }

  const addSheet = (): void => {
    setGrids((prev) => [...prev, { name: `Sheet${prev.length + 1}`, rows: [['']] }])
    setActive(grids.length)
  }

  const removeSheet = (index: number): void => {
    if (grids.length <= 1) return
    setGrids((prev) => prev.filter((_, i) => i !== index))
    setActive((prev) => Math.max(0, prev - 1))
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

  const rowCount = Math.max(1, grid?.rows.length ?? 1)
  const colCount = Math.max(1, ...(grid?.rows.map((r) => r.length) ?? [1]))

  return (
    <div className={css.container}>
      <div className={css.toolbar}>
        {grids.map((gridItem, index) => (
          <span key={gridItem.name} className={css.sheetTabWrap}>
            <button
              type="button"
              className={[css.sheetTab, index === active ? css.sheetTabActive : ''].join(' ')}
              onClick={() => setActive(index)}
              onDoubleClick={() => {
                const name = globalThis.prompt('Sheet name', gridItem.name)
                if (name !== null && name.trim() !== '') {
                  setGrids((prev) => prev.map((g, gi) => (gi === index ? { ...g, name: name.trim() } : g)))
                }
              }}
            >
              {gridItem.name}
            </button>
            {grids.length > 1 && (
              <button type="button" className={css.sheetTabDel} title={t('sheet.removeSheet')} onClick={() => removeSheet(index)}>×</button>
            )}
          </span>
        ))}
        <button type="button" className={css.button} onClick={addSheet}>{t('sheet.addSheet')}</button>
        <span className={css.spacer} />
        {status !== '' && <span className={css.status}>{status}</span>}
        <button type="button" className={css.button} onClick={insertRow}>{t('sheet.insertRow')}</button>
        <button type="button" className={css.button} onClick={insertCol}>{t('sheet.insertCol')}</button>
        <button type="button" className={css.button} onClick={deleteRow}>{t('sheet.deleteRow')}</button>
        <button type="button" className={css.button} onClick={deleteCol}>{t('sheet.deleteCol')}</button>
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
                {Array.from({ length: colCount }, (_, c) => (
                  <th key={c} className={css.gridHead} style={{ width: colWidths[c] ?? 96 }}>
                    <span className={css.gridHeadLabel}>{colLetter(c)}</span>
                    <span
                      className={css.colResizer}
                      role="separator"
                      aria-orientation="vertical"
                      onPointerDown={(event) => {
                        event.preventDefault()
                        const startX = event.clientX
                        const startWidth = colWidths[c] ?? 96
                        const move = (moveEvent: PointerEvent): void => {
                          setColWidths((prev) => {
                            const next = [...prev]
                            next[c] = Math.max(40, Math.min(480, startWidth + (moveEvent.clientX - startX)))
                            return next
                          })
                        }
                        const up = (): void => {
                          window.removeEventListener('pointermove', move)
                          window.removeEventListener('pointerup', up)
                        }
                        window.addEventListener('pointermove', move)
                        window.addEventListener('pointerup', up)
                      }}
                    />
                  </th>
                ))}
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

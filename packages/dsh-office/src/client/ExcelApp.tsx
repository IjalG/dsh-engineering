/**
 * Excel app: grid editor with a real formula engine (hyperformula), an fx
 * formula bar, auto-sum, sorting, and number formats. Cells holding formulas
 * display their computed value; focusing a cell reveals its formula in the
 * fx bar (and inline while editing).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { HyperFormula } from 'hyperformula'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeKey } from './locales.ts'
import type { SheetFreeze, SheetGrid, SheetMerge } from '../docs.ts'
import { OfficeApi } from './api.ts'
import css from './office.module.css'

export interface ExcelAppProps {
  path: string
  t: Translate<OfficeKey>
}

const api = new OfficeApi()

const MAX_ROWS = 500
const MAX_COLS = 80

/** Cell display format. */
type CellFormat = 'auto' | 'number' | 'percent' | 'currency' | 'date'

/** Formats per sheet: "row:col" -> CellFormat. */
type FormatMap = Record<string, Record<string, CellFormat>>

function colLetter(index: number): string {
  let n = index
  let letter = ''
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return letter
}

function cellAddress(col: number, row: number): string {
  return `${colLetter(col)}${row + 1}`
}

/** Format a raw value for display. */
function formatValue(raw: string, format: CellFormat): string {
  if (format === 'auto') return raw
  const number = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(number) || raw.trim() === '') return raw
  try {
    if (format === 'number') return number.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
    if (format === 'percent') return `${(number * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`
    if (format === 'currency') return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (format === 'date') {
      const date = new Date(number)
      if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('zh-CN')
      return raw
    }
  } catch {
    // fall through
  }
  return raw
}

export function ExcelApp({ path, t }: ExcelAppProps): React.ReactElement {
  const [grids, setGrids] = useState<SheetGrid[]>([])
  const [active, setActive] = useState(0)
  const [colWidths, setColWidths] = useState<number[]>([])
  const [formats, setFormats] = useState<FormatMap>({})
  const [merges, setMerges] = useState<SheetMerge[]>([])
  const [freezes, setFreezes] = useState<SheetFreeze[]>([])
  const [chartOpen, setChartOpen] = useState(false)
  const [filter, setFilter] = useState<{ col: number; value: string } | undefined>()
  const [selected, setSelected] = useState<{ col: number; row: number }>({ col: 0, row: 0 })
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
      setMerges(result.merges ?? [])
      setFreezes(result.freezes ?? [])
      setActive(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => { void load() }, [load])

  const grid = grids[active]

  // ---- formula engine: rebuild on grid change ----
  const hf = useMemo(() => {
    if (grid === undefined) return undefined
    try {
      const sheets: Record<string, string[][]> = {}
      for (const g of grids) sheets[g.name] = g.rows
      return HyperFormula.buildFromSheets(sheets, {
        licenseKey: 'gpl-v3',
        useArrayArithmetic: true,
      })
    } catch {
      return undefined
    }
  }, [grids, grid])

  /** Computed display value for one cell. */
  const displayValue = useCallback((sheet: string, row: number, col: number, raw: string): string => {
    const format = formats[sheet]?.[`${row}:${col}`] ?? 'auto'
    if (raw.startsWith('=')) {
      try {
        const sheetId = hf?.getSheetId(sheet)
        const computed = sheetId !== undefined ? hf?.getCellValue({ sheet: sheetId, col, row }) : undefined
        if (computed !== undefined) {
          const text = String(computed)
          return format === 'auto' ? text : formatValue(text, format)
        }
      } catch {
        // formula error -> raw
      }
      return raw
    }
    return formatValue(raw, format)
  }, [hf, formats])

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

  /** Auto-sum: fill the selected cell with =SUM(col 1..row-1). */
  const autoSum = (): void => {
    if (grid === undefined) return
    const { col, row } = selected
    if (row === 0) return
    const range = `${colLetter(col)}1:${colLetter(col)}${row}`
    setCell(row, col, `=SUM(${range})`)
  }

  /** Sort rows by the selected column. */
  const sort = (direction: 'asc' | 'desc'): void => {
    if (grid === undefined || grid.rows.length < 2) return
    setGrids((prev) => prev.map((g, gi) => {
      if (gi !== active) return g
      const header = g.rows[0] ?? []
      const body = g.rows.slice(1)
      body.sort((a, b) => {
        const av = a[selected.col] ?? ''
        const bv = b[selected.col] ?? ''
        const an = Number(av)
        const bn = Number(bv)
        const cmp = Number.isFinite(an) && Number.isFinite(bn)
          ? an - bn
          : av.localeCompare(bv, 'zh-CN')
        return direction === 'asc' ? cmp : -cmp
      })
      return { ...g, rows: [header, ...body] }
    }))
  }

  const setFormat = (format: CellFormat): void => {
    if (grid === undefined) return
    const key = `${selected.row}:${selected.col}`
    setFormats((prev) => {
      const next: FormatMap = { ...prev }
      const sheetMap = { ...(next[grid.name] ?? {}) }
      sheetMap[key] = format
      next[grid.name] = sheetMap
      return next
    })
  }

  /** Merge the selected cell with the cell to its right. */
  const mergeSelected = (): void => {
    if (grid === undefined) return
    const { col, row } = selected
    if (col + 1 >= Math.max(1, ...grid.rows.map((r) => r.length))) return
    const overlap = merges.some((m) => m.sheet === grid.name && row + 1 >= m.r1 && row + 1 <= m.r2 && col + 1 >= m.c1 && col + 1 <= m.c2)
    if (overlap) { setError('与已有合并区域重叠'); return }
    setMerges((prev) => [...prev, { sheet: grid.name, r1: row + 1, c1: col + 1, r2: row + 1, c2: col + 2 }])
  }

  /** Unmerge any range covering the selected cell. */
  const unmergeSelected = (): void => {
    if (grid === undefined) return
    const { col, row } = selected
    setMerges((prev) => prev.filter((m) => !(m.sheet === grid.name && row + 1 >= m.r1 && row + 1 <= m.r2 && col + 1 >= m.c1 && col + 1 <= m.c2)))
  }

  /** Toggle freezing the header row of the active sheet. */
  const toggleFreeze = (): void => {
    if (grid === undefined) return
    const existing = freezes.find((f) => f.sheet === grid.name)
    if (existing !== undefined && existing.rows > 0) {
      setFreezes((prev) => prev.filter((f) => f.sheet !== grid.name))
    } else {
      setFreezes((prev) => [...prev.filter((f) => f.sheet !== grid.name), { sheet: grid.name, rows: 1, cols: 0 }])
    }
  }

  const save = async (): Promise<void> => {
    setStatus(t('editor.saving'))
    try {
      const result = await api.sheetSave(path, grids, merges, freezes)
      if (!result.ok) { setError(result.error); setStatus('') }
      else { setStatus(t('editor.saved')); setTimeout(() => setStatus(''), 1500) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('')
    }
  }

  const rowCount = Math.max(1, grid?.rows.length ?? 1)
  const colCount = Math.max(1, ...(grid?.rows.map((r) => r.length) ?? [1]))
  const selectedRaw = grid?.rows[selected.row]?.[selected.col] ?? ''
  const selectedComputed = grid !== undefined ? displayValue(grid.name, selected.row, selected.col, selectedRaw) : ''

  // Merged-cell render plan for the active sheet: spans + skipped cells.
  const sheetMerges = grid !== undefined ? merges.filter((m) => m.sheet === grid.name) : []
  const mergeSpan = new Map<string, { colSpan: number; rowSpan: number }>()
  const skipCells = new Set<string>()
  for (const m of sheetMerges) {
    mergeSpan.set(`${m.r1 - 1}:${m.c1 - 1}`, { colSpan: m.c2 - m.c1 + 1, rowSpan: m.r2 - m.r1 + 1 })
    for (let r = m.r1 - 1; r <= m.r2 - 1; r++) {
      for (let c = m.c1 - 1; c <= m.c2 - 1; c++) {
        if (r !== m.r1 - 1 || c !== m.c1 - 1) skipCells.add(`${r}:${c}`)
      }
    }
  }
  const visibleRowCount = rowCount
  const filteredRows = filter !== undefined
    ? grid?.rows.map((row, index) => ({ row, index })).filter(({ row }) => (row[filter.col] ?? '').toLowerCase().includes(filter.value.toLowerCase()))
    : grid?.rows.map((row, index) => ({ row, index }))

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
        <button type="button" className={css.button} onClick={() => sort('asc')}>{t('sheet.sortAsc')}</button>
        <button type="button" className={css.button} onClick={() => sort('desc')}>{t('sheet.sortDesc')}</button>
        <button type="button" className={css.button} onClick={mergeSelected} title={t('sheet.mergeCells')}>{t('sheet.mergeCells')}</button>
        <button type="button" className={css.button} onClick={unmergeSelected} title={t('sheet.unmergeCells')}>{t('sheet.unmergeCells')}</button>
        <input
          className={css.filterInput}
          placeholder={t('sheet.filter')}
          value={filter?.value ?? ''}
          onChange={(event) => setFilter(event.target.value === '' ? undefined : { col: selected.col, value: event.target.value })}
        />
        <button type="button" className={css.button} onClick={toggleFreeze}>
          {(freezes.find((f) => f.sheet === grid?.name)?.rows ?? 0) > 0 ? t('sheet.unfreeze') : t('sheet.freeze')}
        </button>
        <button type="button" className={css.button} onClick={() => setChartOpen(true)}>{t('sheet.chart')}</button>
        <button type="button" className={css.button} onClick={() => void save()}>{t('editor.save')}</button>
      </div>
      {/* fx formula bar */}
      <div className={css.fxBar}>
        <span className={css.fxName}>{cellAddress(selected.col, selected.row)}</span>
        <button type="button" className={css.fxSum} title={t('sheet.autoSum')} onClick={autoSum}>Σ</button>
        <span className={css.fxLabel}>{t('sheet.fx')}</span>
        <input
          className={css.fxInput}
          value={selectedRaw}
          onChange={(event) => setCell(selected.row, selected.col, event.target.value)}
          placeholder={t('sheet.formula')}
        />
        <span className={css.fxValue}>{selectedComputed}</span>
      </div>
      <div className={css.formatBar}>
        <button type="button" className={css.toolButton} onClick={() => setFormat('number')}>{t('sheet.number')}</button>
        <button type="button" className={css.toolButton} onClick={() => setFormat('percent')}>{t('sheet.percent')}</button>
        <button type="button" className={css.toolButton} onClick={() => setFormat('currency')}>{t('sheet.currency')}</button>
        <button type="button" className={css.toolButton} onClick={() => setFormat('date')}>{t('sheet.date')}</button>
        <button type="button" className={css.toolButton} onClick={() => setFormat('auto')}>A</button>
      </div>
      {error !== undefined && <div className={css.error}>{error}</div>}
      {loading && <div className={css.hint}>{t('editor.saving')}</div>}
      {chartOpen && grid !== undefined && (
        <ChartModal grid={grid} col={selected.col} t={t} onClose={() => setChartOpen(false)} />
      )}
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
              {(filteredRows ?? []).map(({ row, index: r }) => (
                <tr key={r}>
                  <th className={css.gridRowHead}>{r + 1}</th>
                  {Array.from({ length: colCount }, (_, c) => {
                    if (skipCells.has(`${r}:${c}`)) return null
                    const raw = row[c] ?? ''
                    const isSelected = selected.col === c && selected.row === r
                    const span = mergeSpan.get(`${r}:${c}`)
                    return (
                      <td key={c} colSpan={span?.colSpan} rowSpan={span?.rowSpan} className={[css.gridCell, isSelected ? css.gridCellSelected : ''].join(' ')}>
                        <input
                          className={css.gridInput}
                          value={displayValue(grid.name, r, c, raw)}
                          data-raw={raw.startsWith('=') ? raw : undefined}
                          onChange={(event) => setCell(r, c, event.target.value)}
                          onFocus={(event) => { setSelected({ col: c, row: r }); if (raw.startsWith('=')) event.target.value = raw }}
                          onBlur={(event) => { if (raw.startsWith('=')) event.target.value = displayValue(grid.name, r, c, raw) }}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Lightweight SVG bar chart over one column's numeric data. */
function ChartModal({ grid, col, t, onClose }: {
  grid: SheetGrid
  col: number
  t: Translate<OfficeKey>
  onClose: () => void
}): React.ReactElement {
  const values = grid.rows.slice(1)
    .map((row) => Number(String(row[col] ?? '').replace(/,/g, '')))
    .filter((n) => Number.isFinite(n))
  const max = Math.max(...values, 0)
  const barWidth = 34
  const gap = 18
  const width = Math.max(240, values.length * (barWidth + gap) + 60)
  const height = 240

  return (
    <div className={css.chartOverlay} onClick={onClose} role="presentation">
      <div className={css.chartPanel} onClick={(event) => event.stopPropagation()} role="presentation">
        <div className={css.chartHead}>
          <span className={css.sectionTitle}>{grid.name}</span>
          <button type="button" className={css.button} onClick={onClose}>×</button>
        </div>
        {values.length === 0 ? (
          <div className={css.hint}>{t('sheet.chart')}</div>
        ) : (
          <svg width={width} height={height} className={css.chartSvg} role="img" aria-label={t('sheet.chart')}>
            <line x1="40" y1={height - 30} x2={width - 10} y2={height - 30} stroke="rgba(31,35,40,0.25)" strokeWidth="1" />
            {values.map((value, index) => {
              const barH = max === 0 ? 0 : Math.round((value / max) * (height - 70))
              const x = 44 + index * (barWidth + gap)
              const y = height - 30 - barH
              return (
                <g key={index}>
                  <rect x={x} y={y} width={barWidth} height={barH} rx="4" fill="rgba(59,130,246,0.75)" />
                  <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize="10.5" fill="rgba(31,35,40,0.7)">{value}</text>
                  <text x={x + barWidth / 2} y={height - 14} textAnchor="middle" fontSize="10" fill="rgba(31,35,40,0.5)">{index + 1}</text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </div>
  )
}

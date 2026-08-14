/**
 * PDF viewer: host renders pages to PNG (pdftoppm); the client shows the
 * current page image with page navigation and zoom.
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeKey } from './locales.ts'
import { OfficeApi } from './api.ts'
import css from './office.module.css'

export interface PdfViewerProps {
  path: string
  t: Translate<OfficeKey>
}

interface PdfPage {
  page: number
  base64: string
  mime: string
}

const api = new OfficeApi()

export function PdfViewer({ path, t }: PdfViewerProps): React.ReactElement {
  const [pages, setPages] = useState<PdfPage[]>([])
  const [pageNum, setPageNum] = useState(1)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(async (): Promise<void> => {
    setError(undefined)
    setPages([])
    try {
      const result = await api.pdfPages(path)
      if (!result.ok) { setError(result.error); return }
      setPages(result.pages)
      setPageNum(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [path])

  useEffect(() => { void load() }, [load])

  const goto = (pageNo: number): void => {
    setPageNum(Math.max(1, Math.min(pages.length, pageNo)))
  }

  const zoom = (delta: number): void => {
    setScale((prev) => Math.max(0.4, Math.min(3, prev + delta)))
  }

  const current = pages.find((page) => page.page === pageNum)

  return (
    <div className={css.pdfViewer}>
      <div className={css.formatBar}>
        <button type="button" className={css.toolButton} disabled={pageNum <= 1} onClick={() => goto(pageNum - 1)}>{t('pdf.prev')}</button>
        <span className={css.pageInfo}>{t('pdf.pageOf').replace('{n}', String(pageNum)).replace('{total}', String(pages.length))}</span>
        <button type="button" className={css.toolButton} disabled={pageNum >= pages.length} onClick={() => goto(pageNum + 1)}>{t('pdf.next')}</button>
        <span className={css.barSeparator} />
        <button type="button" className={css.toolButton} onClick={() => zoom(-0.2)}>{t('pdf.zoomOut')}</button>
        <button type="button" className={css.toolButton} onClick={() => zoom(0.2)}>{t('pdf.zoomIn')}</button>
      </div>
      {error !== undefined && <div className={css.error}>{error}</div>}
      <div className={css.pdfCanvasScroll}>
        {current !== undefined ? (
          <img
            className={css.pdfPageImg}
            src={`data:${current.mime};base64,${current.base64}`}
            alt={`${t('pdf.pageOf').replace('{n}', String(pageNum)).replace('{total}', String(pages.length))}`}
            style={{ width: `${Math.round(100 * scale)}%` }}
          />
        ) : (
          <div className={css.hint}>{t('editor.saving')}</div>
        )}
      </div>
    </div>
  )
}

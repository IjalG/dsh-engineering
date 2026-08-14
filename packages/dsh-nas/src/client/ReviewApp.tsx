/**
 * Review window: agent-staged edits (from nas_edit / staged writes) with a
 * diff view — accept keeps the new content, reject restores the original.
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NasKey } from './locales.ts'
import type { NasWindow } from './store.ts'
import { NasApi } from './api.ts'
import css from './desktop.module.css'

export interface ReviewAppProps {
  window: NasWindow
  t: Translate<NasKey>
}

type ReviewStatus = 'pending' | 'accepted' | 'rejected'

interface ReviewView {
  id: number
  path: string
  status: ReviewStatus
  createdAt: number
  actor: string
  oldContent?: string
  newContent?: string
}

function asStatus(value: string): ReviewStatus {
  return value === 'accepted' ? 'accepted' : value === 'rejected' ? 'rejected' : 'pending'
}

const api = new NasApi()

/** Simple line diff: lines removed/added between old and new. */
function lineDiff(oldText: string, newText: string): Array<{ type: 'same' | 'del' | 'add'; text: string }> {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: Array<{ type: 'same' | 'del' | 'add'; text: string }> = []
  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({ type: 'same', text: oldLines[i]! })
      i++; j++
    } else if (j < newLines.length && (i >= oldLines.length || newLines[j] === oldLines[i + 1])) {
      result.push({ type: 'add', text: newLines[j]! })
      j++
    } else if (i < oldLines.length) {
      result.push({ type: 'del', text: oldLines[i]! })
      i++
    } else if (j < newLines.length) {
      result.push({ type: 'add', text: newLines[j]! })
      j++
    }
  }
  return result
}

export function ReviewApp({ t }: ReviewAppProps): React.ReactElement {
  const [items, setItems] = useState<ReviewView[]>([])
  const [selected, setSelected] = useState<ReviewView | undefined>()
  const [error, setError] = useState<string | undefined>()

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await api.reviewList()
      const views: ReviewView[] = result.items.map((item) => ({ ...item, status: asStatus(item.status) }))
      setItems(views)
      setSelected((prev) => prev !== undefined ? views.find((v) => v.id === prev.id) ?? prev : prev)
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const open = async (id: number): Promise<void> => {
    try {
      const result = await api.reviewDiff(id)
      if (result.record !== undefined) setSelected({ ...result.record, status: asStatus(result.record.status) })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const act = async (id: number, action: 'accept' | 'reject'): Promise<void> => {
    const result = action === 'accept' ? await api.reviewAccept(id) : await api.reviewReject(id)
    if (!result.ok && result.error !== undefined) setError(result.error)
    void refresh()
  }

  const fmtTime = (ms: number): string => new Date(ms).toLocaleString()

  return (
    <div className={css.fm}>
      <div className={css.fmToolbar}>
        <span className={css.fmCwd}>{t('review.title')}</span>
        <span className={css.fmSpacer} />
        <button type="button" className={css.fmButton} onClick={() => void refresh()}>{t('fm.refresh')}</button>
      </div>
      {error !== undefined && <div className={css.fmError}>{error}</div>}
      {selected === undefined ? (
        <div className={css.fmList}>
          {items.length === 0 && <div className={css.fmEmpty}>{t('review.empty')}</div>}
          {items.map((item) => (
            <button key={item.id} type="button" className={css.fmRow} onClick={() => void open(item.id)}>
              <span className={[css.reviewDot, item.status === 'pending' ? css.reviewDotPending : item.status === 'accepted' ? css.reviewDotOk : css.reviewDotNo].join(' ')} aria-hidden="true" />
              <span className={css.fmName}>{item.path}</span>
              <span className={css.reviewStatus} data-status={item.status}>{item.status}</span>
              <span className={css.fmMeta}>{item.actor} · {fmtTime(item.createdAt)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className={css.reviewDetail}>
          <div className={css.reviewDetailHead}>
            <span className={css.fmName}>{selected.path}</span>
            <span className={[css.reviewStatus, `is-${selected.status}`].join(' ')}>{selected.status}</span>
            <span className={css.fmMeta}>{fmtTime(selected.createdAt)}</span>
            <span className={css.fmSpacer} />
            {selected.status === 'pending' && (
              <>
                <button type="button" className={css.fmButton} onClick={() => void act(selected.id, 'accept')}>{t('review.accept')}</button>
                <button type="button" className={[css.fmButton, css.fmDanger].join(' ')} onClick={() => void act(selected.id, 'reject')}>{t('review.reject')}</button>
              </>
            )}
            <button type="button" className={css.fmButton} onClick={() => setSelected(undefined)}>{t('review.back')}</button>
          </div>
          <div className={css.reviewDiff}>
            {lineDiff(selected.oldContent ?? '', selected.newContent ?? '').map((line, index) => (
              <div key={index} className={[css.reviewLine, `is-${line.type}`].join(' ')}>
                <span className={css.reviewLineNo}>{index + 1}</span>
                <span className={css.reviewLineText}>{line.text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

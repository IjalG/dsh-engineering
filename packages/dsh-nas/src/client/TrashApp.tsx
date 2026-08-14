/**
 * Trash window: lists deleted items (original location, size, deleted time),
 * restores them back into the workspace, and empties the trash (the only
 * destructive path — double confirmation).
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NasKey } from './locales.ts'
import type { NasTrashEntry } from '../protocol.ts'
import type { NasWindow } from './store.ts'
import { NasApi } from './api.ts'
import css from './desktop.module.css'

export interface TrashAppProps {
  window: NasWindow
  t: Translate<NasKey>
}

const api = new NasApi()

export function TrashApp({ t }: TrashAppProps): React.ReactElement {
  const [items, setItems] = useState<NasTrashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await api.trashList()
      setItems(result.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const restore = async (id: string): Promise<void> => {
    const result = await api.trashRestore(id)
    if (!result.ok && result.error !== undefined) setError(result.error)
    void refresh()
  }

  const emptyAll = async (): Promise<void> => {
    if (!window.confirm(t('trash.confirmEmpty'))) return
    const result = await api.trashEmpty()
    if (!result.ok && result.error !== undefined) setError(result.error)
    void refresh()
  }

  const formatTime = (ms: number): string => {
    const date = new Date(ms)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  return (
    <div className={css.fm}>
      <div className={css.fmToolbar}>
        <span className={css.fmCwd}>{t('trash.title')}</span>
        <span className={css.fmSpacer} />
        <button type="button" className={css.fmButton} onClick={() => void refresh()}>{t('fm.refresh')}</button>
        <button type="button" className={[css.fmButton, css.fmDanger].join(' ')} onClick={() => void emptyAll()} disabled={items.length === 0}>
          {t('trash.emptyAll')}
        </button>
      </div>
      {error !== undefined && <div className={css.fmError}>{error}</div>}
      <div className={css.fmList}>
        {items.length === 0 && !loading && <div className={css.fmEmpty}>{t('trash.empty')}</div>}
        {items.map((item) => (
          <div key={item.id} className={css.fmRow}>
            <div className={css.fmRowMain}>
              <span className={[css.fmIcon, item.kind === 'dir' ? css.fmIconDir : css.fmIconFile].join(' ')} aria-hidden="true" />
              <span className={css.fmName}>{item.name}</span>
              <span className={css.fmMeta}>{t('trash.origin')}: {item.originalPath}</span>
              <span className={css.fmMeta}>{t('trash.deletedAt')}: {formatTime(item.deletedAt)}</span>
            </div>
            <div className={css.fmRowActions}>
              <button type="button" className={css.fmMini} title={t('trash.restore')} onClick={() => void restore(item.id)}>R</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Search window (M1 placeholder): lists workspace files filtered by name.
 * The full-text search engine (SQLite FTS5 + Chinese tokenizer) lands in M2;
 * the window shell and navigation are already in place.
 */

import React, { useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NasKey } from './locales.ts'
import type { NasFsEntry } from '../protocol.ts'
import type { NasWindow } from './store.ts'
import { NasApi } from './api.ts'
import { desktopStore } from './store.ts'
import css from './desktop.module.css'

export interface SearchAppProps {
  window: NasWindow
  t: Translate<NasKey>
}

const api = new NasApi()

export function SearchApp({ t }: SearchAppProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NasFsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [scanned, setScanned] = useState(false)

  useEffect(() => {
    if (query.trim() === '') {
      setResults([])
      setScanned(false)
      return
    }
    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true)
        try {
          const all: NasFsEntry[] = []
          const stack = ['']
          while (stack.length > 0 && all.length < 500) {
            const dir = stack.pop() ?? ''
            const result = await api.list(dir)
            if (result.error !== undefined) continue
            for (const entry of result.entries) {
              if (all.length >= 500) break
              if (entry.kind === 'dir') stack.push(entry.path)
              else all.push(entry)
            }
          }
          const needle = query.trim().toLowerCase()
          setResults(all.filter((entry) => entry.name.toLowerCase().includes(needle)))
          setScanned(true)
        } catch {
          setScanned(true)
        } finally {
          setLoading(false)
        }
      })()
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const openEntry = (entry: NasFsEntry): void => {
    const apps = desktopStore.getSnapshot().apps
    const app = apps.find((item) => item.fileExts.includes(entry.ext))
    if (app !== undefined) {
      desktopStore.openWindow(app.windowKind, app.name, { path: entry.path })
      return
    }
    desktopStore.openWindow('preview', entry.name, { path: entry.path, editable: true })
  }

  return (
    <div className={css.fm}>
      <div className={css.fmToolbar}>
        <input
          className={css.fmSearch}
          placeholder={t('fm.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      </div>
      <div className={css.fmList}>
        {query.trim() === '' && <div className={css.fmEmpty}>{t('app.search')}</div>}
        {query.trim() !== '' && !loading && scanned && results.length === 0 && <div className={css.fmEmpty}>—</div>}
        {results.map((entry) => (
          <div key={entry.path} className={css.fmRow}>
            <button type="button" className={css.fmRowMain} onClick={() => openEntry(entry)}>
              <span className={[css.fmIcon, entry.kind === 'dir' ? css.fmIconDir : css.fmIconFile].join(' ')} aria-hidden="true" />
              <span className={css.fmName}>{entry.name}</span>
              <span className={css.fmMeta}>{entry.path}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

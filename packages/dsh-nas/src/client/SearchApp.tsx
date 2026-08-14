/**
 * Search window: full-text query over workspace files (name + text content
 * via FTS5 with CJK bigram tokenization). Hits open in the matching app or
 * the text preview.
 */

import React, { useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NasKey } from './locales.ts'
import type { SearchHit } from '../search.ts'
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
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (query.trim() === '') {
      setHits([])
      setSearched(false)
      return
    }
    const timer = setTimeout(() => {
      void (async () => {
        setSearching(true)
        try {
          const result = await api.search(query.trim(), 100)
          setHits(result.hits)
          setSearched(true)
        } catch {
          setHits([])
          setSearched(true)
        } finally {
          setSearching(false)
        }
      })()
    }, 350)
    return () => clearTimeout(timer)
  }, [query])

  const openEntry = (hit: SearchHit): void => {
    const apps = desktopStore.getSnapshot().apps
    const dot = hit.name.lastIndexOf('.')
    const ext = dot >= 0 ? hit.name.slice(dot + 1).toLowerCase() : ''
    const app = apps.find((item) => item.fileExts.includes(ext))
    if (app !== undefined) {
      desktopStore.openWindow(app.windowKind, app.name, { path: hit.path })
      return
    }
    desktopStore.openWindow('preview', hit.name, { path: hit.path, editable: true })
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
        {query.trim() !== '' && !searching && searched && hits.length === 0 && <div className={css.fmEmpty}>{t('search.noResults')}</div>}
        {hits.map((hit) => (
          <div key={hit.path} className={css.fmRow}>
            <button type="button" className={css.fmRowMain} onClick={() => openEntry(hit)}>
              <span className={css.fmIconFile} aria-hidden="true" />
              <span className={css.fmName}>{hit.name}</span>
              <span className={css.searchSnippet}>{hit.snippet}</span>
              <span className={css.fmMeta}>{hit.path}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

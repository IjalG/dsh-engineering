/**
 * Text preview window: reads a workspace text file (bounded), shows it
 * read-only with save support for editable text files. Binary files show a
 * hint. This is the fallback renderer when no software package owns the
 * extension; Office/PDF/email windows come from the software packages.
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NasKey } from './locales.ts'
import type { NasWindow } from './store.ts'
import { NasApi } from './api.ts'
import css from './desktop.module.css'

export interface PreviewProps {
  window: NasWindow
  t: Translate<NasKey>
}

const api = new NasApi()

export function Preview({ window, t }: PreviewProps): React.ReactElement {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [truncated, setTruncated] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await api.read(window.path ?? '', 1024 * 1024)
      if (!result.ok) {
        setError(result.error)
      } else {
        setContent(result.content ?? '')
        setTruncated(result.truncated ?? false)
        setDirty(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [window.path])

  useEffect(() => { void load() }, [load])

  const save = async (): Promise<void> => {
    if (window.path === undefined) return
    const result = await api.write(window.path, content)
    if (!result.ok) setError(result.error)
    else {
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  return (
    <div className={css.preview}>
      <div className={css.previewBar}>
        <span className={css.previewPath}>{window.path ?? ''}</span>
        <span className={css.fmSpacer} />
        {window.editable === true && (
          <button type="button" className={css.fmButton} onClick={() => void save()} disabled={!dirty}>
            {saved ? t('common.saved') : t('common.save')}
          </button>
        )}
      </div>
      {loading && <div className={css.previewEmpty}>…</div>}
      {error !== undefined && !loading && <div className={css.fmError}>{error}</div>}
      {!loading && error === undefined && (
        window.editable === true ? (
          <textarea
            className={css.previewTextarea}
            value={content}
            onChange={(event) => { setContent(event.target.value); setDirty(true) }}
            spellCheck={false}
          />
        ) : (
          <pre className={css.previewPre}>
            {content}
            {truncated && <span className={css.previewTruncated}>{t('preview.truncated')}</span>}
          </pre>
        )
      )}
    </div>
  )
}

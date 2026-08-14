/**
 * Office window container: routes by file extension to the Word (TipTap),
 * Excel (grid) or PDF tools; no path shows the new-document welcome page.
 */

import React, { useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
/** Window shape the nas desktop passes (structural; no cross-package type dep). */
export interface NasWindowLike {
  id: string
  kind: string
  title: string
  path?: string
  editable?: boolean
}
import type { OfficeKey } from './locales.ts'
import { WordApp } from './WordApp.tsx'
import { ExcelApp } from './ExcelApp.tsx'
import { PdfApp } from './PdfApp.tsx'
import { PptApp } from './PptApp.tsx'
import { OfficeApi, setOfficeSessionId } from './api.ts'
import css from './office.module.css'

export interface OfficeWindowProps {
  window: NasWindowLike
  close: () => void
  t: Translate<OfficeKey>
  sessionId?: string
}

const api = new OfficeApi()

function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
}

/** Welcome page: create a new office document. */
function Welcome({ t, onOpen }: { t: Translate<OfficeKey>; onOpen: (path: string) => void }): React.ReactElement {
  const [newName, setNewName] = useState('')
  const create = (kind: 'docx' | 'xlsx'): void => {
    const name = newName.trim() === '' ? `untitled-${Date.now()}.${kind}` : newName.trim().endsWith(`.${kind}`) ? newName.trim() : `${newName.trim()}.${kind}`
    onOpen(name)
  }
  return (
    <div className={css.welcome}>
      <div className={css.welcomeTitle}>{t('welcome.title')}</div>
      <div className={css.welcomeRow}>
        <input className={css.input} placeholder="name" value={newName} onChange={(event) => setNewName(event.target.value)} />
      </div>
      <div className={css.welcomeRow}>
        <button type="button" className={css.button} onClick={() => create('docx')}>{t('welcome.word')}</button>
        <button type="button" className={css.button} onClick={() => create('xlsx')}>{t('welcome.sheet')}</button>
      </div>
      <div className={css.welcomeHint}>{t('welcome.open')}</div>
    </div>
  )
}

/** The office window. */
export function OfficeWindow({ window, t, sessionId }: OfficeWindowProps): React.ReactElement {
  useEffect(() => { setOfficeSessionId(sessionId) }, [sessionId])
  const [currentPath, setCurrentPath] = useState<string | undefined>(window.path)
  const [browse, setBrowse] = useState(false)
  const [files, setFiles] = useState<Array<{ path: string; name: string }>>([])

  useEffect(() => {
    if (!browse) return
    void (async () => {
      try {
        const response = await fetch('/api/dsh-nas/fs.list', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: document.querySelector<HTMLElement>('[data-session-id]')?.dataset.sessionId }),
        })
        const result = (await response.json()) as { entries?: Array<{ path: string; name: string; kind: string }> }
        setFiles((result.entries ?? []).filter((entry) => entry.kind === 'file' && /\.(docx|xlsx|pptx|pdf)$/i.test(entry.name)))
      } catch {
        setFiles([])
      }
    })()
  }, [browse])

  if (currentPath === undefined) {
    return (
      <div className={css.container}>
        <div className={css.toolbar}>
          <button type="button" className={css.button} onClick={() => setBrowse((open) => !open)}>{t('welcome.open')}</button>
        </div>
        {browse && (
          <div className={css.fileList}>
            {files.map((file) => (
              <button key={file.path} type="button" className={css.fileRow} onClick={() => { setCurrentPath(file.path); setBrowse(false) }}>
                {file.name}
              </button>
            ))}
          </div>
        )}
        <Welcome t={t} onOpen={setCurrentPath} />
      </div>
    )
  }

  const ext = extOf(currentPath)
  if (ext === 'docx') return <WordApp t={t} path={currentPath} />
  if (ext === 'xlsx') return <ExcelApp t={t} path={currentPath} />
  if (ext === 'pptx') return <PptApp t={t} path={currentPath} />
  if (ext === 'pdf') return <PdfApp t={t} path={currentPath} />
  return (
    <div className={css.container}>
      <div className={css.toolbar}>
        <span>{currentPath}</span>
      </div>
      <div className={css.hint}>{t('editor.unsupported')}</div>
    </div>
  )
}

/** Re-export for the entry. */
export { api as officeApi }

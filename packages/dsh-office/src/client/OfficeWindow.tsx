/**
 * Office window container: routes by file extension to the Word (TipTap),
 * Excel (grid) or PDF tools; no path shows the new-document welcome page.
 */

import React, { useCallback, useEffect, useState } from 'react'
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
import { UniverSheetApp } from './UniverSheetApp.tsx'
import { PdfApp } from './PdfApp.tsx'
import { PptApp } from './PptApp.tsx'
import { OfficeApi, setOfficeSessionId } from './api.ts'
import { ALL_TEMPLATES, type TemplateDef } from './templates.ts'
import css from './office.module.css'

export interface OfficeWindowProps {
  window: NasWindowLike
  close: () => void
  t: Translate<OfficeKey>
  sessionId?: string
}

/** Recent files (localStorage, most recent first, capped). */
const RECENT_KEY = 'dsh.office.recent'

function loadRecent(): Array<{ path: string; name: string }> {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown)
    return Array.isArray(parsed) ? parsed.filter((item): item is { path: string; name: string } =>
      typeof item === 'object' && item !== null && typeof (item as { path?: unknown }).path === 'string') : []
  } catch {
    return []
  }
}

function rememberRecent(path: string): void {
  const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
  const next = [{ path, name }, ...loadRecent().filter((item) => item.path !== path)].slice(0, 8)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // best effort
  }
}

const api = new OfficeApi()

function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
}

/** Welcome page: create a new office document (blank or from a template). */
function Welcome({ t, onTemplate }: { t: Translate<OfficeKey>; onTemplate: (template: TemplateDef) => void }): React.ReactElement {
  const [newName, setNewName] = useState('')
  const create = (kind: 'docx' | 'xlsx' | 'pptx', name: string): void => {
    const finalName = name.trim() === '' ? `untitled-${Date.now()}.${kind}` : name.trim().endsWith(`.${kind}`) ? name.trim() : `${name.trim()}.${kind}`
    if (kind === 'docx') onTemplate({ id: 'word-blank', name: '空白文档', kind: 'docx', defaultName: finalName, html: '<p></p>' })
    else if (kind === 'xlsx') onTemplate({ id: 'xlsx-blank', name: '空白工作簿', kind: 'xlsx', defaultName: finalName, grids: [{ name: 'Sheet1', rows: [['']] }] })
    else onTemplate({ id: 'pptx-blank', name: '空白演示', kind: 'pptx', defaultName: finalName, slides: [{ title: '', body: [], layout: 'content' }] })
  }
  return (
    <div className={css.welcome}>
      <div className={css.welcomeTitle}>{t('welcome.title')}</div>
      <div className={css.welcomeRow}>
        <input className={css.input} placeholder="name" value={newName} onChange={(event) => setNewName(event.target.value)} />
      </div>
      <div className={css.welcomeRow}>
        <button type="button" className={css.button} onClick={() => create('docx', newName)}>{t('welcome.word')}</button>
        <button type="button" className={css.button} onClick={() => create('xlsx', newName)}>{t('welcome.sheet')}</button>
        <button type="button" className={css.button} onClick={() => create('pptx', newName)}>{t('welcome.ppt')}</button>
      </div>
      <div className={css.templateTitle}>{t('template.title')}</div>
      <div className={css.templateGrid}>
        {ALL_TEMPLATES.map((template) => (
          <button key={template.id} type="button" className={css.templateCard} onClick={() => onTemplate(template)}>
            <span className={css.templateBadge}>{template.kind.toUpperCase()}</span>
            <span className={css.templateName}>{template.name}</span>
          </button>
        ))}
      </div>
      <div className={css.welcomeHint}>{t('welcome.open')}</div>
    </div>
  )
}

/** The office window. */
export function OfficeWindow({ window, t, sessionId }: OfficeWindowProps): React.ReactElement {
  useEffect(() => { setOfficeSessionId(sessionId) }, [sessionId])
  const [currentPath, setCurrentPath] = useState<string | undefined>(window.path)
  const [recent, setRecent] = useState<Array<{ path: string; name: string }>>(loadRecent())
  const [browse, setBrowse] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [browseDir, setBrowseDir] = useState('')
  const [entries, setEntries] = useState<Array<{ path: string; name: string; kind: 'file' | 'dir' }>>([])

  const listDir = useCallback(async (dir: string): Promise<void> => {
    try {
      const response = await fetch('/api/dsh-nas/fs.list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: dir, sessionId: document.querySelector<HTMLElement>('[data-session-id]')?.dataset.sessionId }),
      })
      const result = (await response.json()) as { entries?: Array<{ path: string; name: string; kind: string }> }
      const all = (result.entries ?? []).map((entry) => ({ path: entry.path, name: entry.name, kind: entry.kind === 'dir' ? 'dir' as const : 'file' as const }))
      setEntries(all.filter((entry) => entry.kind === 'dir' || /\.(docx|xlsx|pptx|pdf)$/i.test(entry.name)))
    } catch {
      setEntries([])
    }
  }, [])

  useEffect(() => {
    if (!browse) return
    void listDir(browseDir)
  }, [browse, browseDir, listDir])

  const parentDir = (dir: string): string => {
    if (dir === '') return ''
    const idx = dir.lastIndexOf('/')
    return idx <= 0 ? '' : dir.slice(0, idx)
  }

  const openPath = (path: string): void => {
    rememberRecent(path)
    setRecent(loadRecent())
    setCurrentPath(path)
    setBrowse(false)
  }

  /** Materialize a template as a workspace file, then open it. */
  const createFromTemplate = async (template: TemplateDef): Promise<void> => {
    const name = globalThis.prompt(`${t('template.namePrompt')}`, `${template.defaultName}.${template.kind}`)
    if (name === null || name.trim() === '') return
    const target = name.trim().endsWith(`.${template.kind}`) ? name.trim() : `${name.trim()}.${template.kind}`
    try {
      if (template.kind === 'docx') await api.wordSave(target, template.html ?? '<p></p>')
      else if (template.kind === 'xlsx') await api.sheetSave(target, template.grids ?? [{ name: 'Sheet1', rows: [['']] }])
      else await api.pptSave(target, template.slides ?? [{ title: '', body: [], layout: 'content' }])
      openPath(target)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (currentPath === undefined) {
    return (
      <div className={css.container}>
        <div className={css.toolbar}>
          <button type="button" className={css.button} onClick={() => setBrowse((open) => !open)}>{t('welcome.open')}</button>
        </div>
        {browse && (
          <div className={css.fileList}>
            <div className={css.browseBar}>
              <button type="button" className={css.button} disabled={browseDir === ''} onClick={() => setBrowseDir(parentDir(browseDir))}>^</button>
              <span className={css.path}>{browseDir === '' ? '/' : `/${browseDir}`}</span>
            </div>
            {entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={css.fileRow}
                onClick={() => {
                  if (entry.kind === 'dir') setBrowseDir(entry.path)
                  else openPath(entry.path)
                }}
              >
                <span className={css.fileKind}>{entry.kind === 'dir' ? '> ' : ''}</span>
                {entry.name}
              </button>
            ))}
          </div>
        )}
        {recent.length > 0 && (
          <div className={css.recentWrap}>
            <div className={css.sectionTitle}>{t('recent.title')}</div>
            {recent.map((item) => (
              <button key={item.path} type="button" className={css.fileRow} onClick={() => openPath(item.path)}>
                <span className={css.fileKind} />
                {item.name}
              </button>
            ))}
          </div>
        )}
        <Welcome t={t} onTemplate={(template) => void createFromTemplate(template)} />
      </div>
    )
  }

  const ext = extOf(currentPath)
  if (ext === 'docx') return <WordApp t={t} path={currentPath} />
  if (ext === 'xlsx') return <UniverSheetApp t={t} path={currentPath} />
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

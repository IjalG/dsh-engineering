/**
 * File manager: the desktop's core app. Breadcrumb navigation, sortable
 * columns (name/size/time), selection with a detail strip, keyboard
 * shortcuts (Delete = trash, F2 = rename), create/rename/move/copy/delete
 * (to trash), and file routing into registered apps or the text preview.
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NasKey } from './locales.ts'
import type { NasFsEntry, NasFsListResult } from '../protocol.ts'
import { isTextExt } from '../protocol.ts'
import type { NasWindow } from './store.ts'
import { NasApi } from './api.ts'
import { desktopStore } from './store.ts'
import css from './desktop.module.css'

export interface FileManagerProps {
  window: NasWindow
  t: Translate<NasKey>
}

const api = new NasApi()

interface FmState {
  cwd: string
  entries: NasFsEntry[]
  loading: boolean
  error?: string
  query: string
  clipboard?: { action: 'copy' | 'move'; path: string }
  sortKey: 'name' | 'size' | 'mtime'
  sortAsc: boolean
  selected?: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Breadcrumb segments of a workspace-relative path. */
function segmentsOf(cwd: string): Array<{ label: string; path: string }> {
  if (cwd === '') return [{ label: '/', path: '' }]
  const parts = cwd.split('/')
  const segments: Array<{ label: string; path: string }> = [{ label: '/', path: '' }]
  for (let i = 0; i < parts.length; i++) {
    segments.push({ label: parts[i]!, path: parts.slice(0, i + 1).join('/') })
  }
  return segments
}

export function FileManager({ t }: FileManagerProps): React.ReactElement {
  const [state, setState] = useState<FmState>({ cwd: '', entries: [], loading: true, query: '', sortKey: 'name', sortAsc: true })

  const refresh = useCallback(async (cwd: string): Promise<void> => {
    setState((prev) => ({ ...prev, loading: true, error: undefined, selected: undefined }))
    try {
      const result: NasFsListResult = await api.list(cwd)
      setState((prev) => ({
        ...prev,
        cwd: result.root,
        entries: result.entries,
        loading: false,
        error: result.error,
      }))
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }, [])

  useEffect(() => { void refresh('') }, [refresh])

  const sorted = [...state.entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    let cmp = 0
    if (state.sortKey === 'name') cmp = a.name.localeCompare(b.name, 'zh-CN')
    else if (state.sortKey === 'size') cmp = a.size - b.size
    else cmp = a.mtime - b.mtime
    return state.sortAsc ? cmp : -cmp
  })

  const visibleEntries = state.query.trim() === ''
    ? sorted
    : sorted.filter((entry) => entry.name.toLowerCase().includes(state.query.trim().toLowerCase()))

  const openEntry = async (entry: NasFsEntry): Promise<void> => {
    if (entry.kind === 'dir') {
      void refresh(entry.path)
      return
    }
    const apps = desktopStore.getSnapshot().apps
    const app = apps.find((item) => item.fileExts.includes(entry.ext))
    if (app !== undefined) {
      desktopStore.openWindow(app.windowKind, app.name, { path: entry.path })
      return
    }
    if (isTextExt(entry.ext)) {
      desktopStore.openWindow('preview', entry.name, { path: entry.path, editable: true })
    } else {
      globalThis.alert(t('app.missingHint').replace('{ext}', entry.ext))
    }
  }

  const createFile = async (): Promise<void> => {
    const name = globalThis.prompt(t('fm.newFile'), 'untitled.txt')
    if (name === null || name.trim() === '') return
    const path = state.cwd === '' ? name.trim() : `${state.cwd}/${name.trim()}`
    const result = await api.write(path, '')
    if (!result.ok && result.error !== undefined) globalThis.alert(result.error)
    else void refresh(state.cwd)
  }

  const createFolder = async (): Promise<void> => {
    const name = globalThis.prompt(t('fm.newFolder'), 'new-folder')
    if (name === null || name.trim() === '') return
    const path = state.cwd === '' ? name.trim() : `${state.cwd}/${name.trim()}`
    const result = await api.mkdir(path)
    if (!result.ok && result.error !== undefined) globalThis.alert(result.error)
    else void refresh(state.cwd)
  }

  const renameEntry = async (entry: NasFsEntry): Promise<void> => {
    const name = globalThis.prompt(t('fm.rename'), entry.name)
    if (name === null || name.trim() === '' || name.trim() === entry.name) return
    const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''
    const dest = dir === '' ? name.trim() : `${dir}/${name.trim()}`
    const result = await api.move(entry.path, dest)
    if (!result.ok && result.error !== undefined) globalThis.alert(result.error)
    else void refresh(state.cwd)
  }

  const deleteEntry = async (entry: NasFsEntry): Promise<void> => {
    if (!globalThis.confirm(t('fm.confirmDelete').replace('{name}', entry.name))) return
    const result = await api.delete(entry.path)
    if (!result.ok && result.error !== undefined) globalThis.alert(result.error)
    else void refresh(state.cwd)
  }

  const copyEntry = (entry: NasFsEntry): void => {
    setState((prev) => ({ ...prev, clipboard: { action: 'copy', path: entry.path } }))
  }

  const cutEntry = (entry: NasFsEntry): void => {
    setState((prev) => ({ ...prev, clipboard: { action: 'move', path: entry.path } }))
  }

  const paste = async (): Promise<void> => {
    if (state.clipboard === undefined) return
    const name = state.clipboard.path.includes('/') ? state.clipboard.path.slice(state.clipboard.path.lastIndexOf('/') + 1) : state.clipboard.path
    const dest = state.cwd === '' ? name : `${state.cwd}/${name}`
    const result = state.clipboard.action === 'copy'
      ? await api.copy(state.clipboard.path, dest)
      : await api.move(state.clipboard.path, dest)
    if (!result.ok && result.error !== undefined) globalThis.alert(result.error)
    setState((prev) => ({ ...prev, clipboard: undefined }))
    void refresh(state.cwd)
  }

  const upDir = (): void => {
    const cwd = state.cwd
    if (cwd === '') return
    const idx = cwd.lastIndexOf('/')
    void refresh(idx <= 0 ? '' : cwd.slice(0, idx))
  }

  const cycleSort = (key: 'name' | 'size' | 'mtime'): void => {
    setState((prev) => {
      if (prev.sortKey === key) return { ...prev, sortAsc: !prev.sortAsc }
      return { ...prev, sortKey: key, sortAsc: true }
    })
  }

  const selectedEntry = state.entries.find((entry) => entry.path === state.selected)

  // Keyboard shortcuts while the list has focus.
  const onListKeyDown = (event: React.KeyboardEvent): void => {
    if (selectedEntry === undefined) return
    if (event.key === 'Delete') {
      event.preventDefault()
      void deleteEntry(selectedEntry)
    } else if (event.key === 'F2') {
      event.preventDefault()
      void renameEntry(selectedEntry)
    }
  }

  return (
    <div className={css.fm}>
      <div className={css.fmToolbar}>
        <button type="button" className={css.fmButton} onClick={() => void refresh('')} title={t('fm.refresh')}>{t('fm.refresh')}</button>
        <button type="button" className={css.fmButton} onClick={upDir} disabled={state.cwd === ''} title={t('fm.up')}>{t('fm.up')}</button>
        <div className={css.crumbs}>
          {segmentsOf(state.cwd).map((segment, index) => (
            <span key={segment.path}>
              {index > 0 && <span className={css.crumbSep}>/</span>}
              <button
                type="button"
                className={[css.crumb, index === segmentsOf(state.cwd).length - 1 ? css.crumbCurrent : ''].join(' ')}
                onClick={() => void refresh(segment.path)}
              >
                {segment.label}
              </button>
            </span>
          ))}
        </div>
        <span className={css.fmSpacer} />
        <input
          className={css.fmSearch}
          placeholder={t('fm.searchPlaceholder')}
          value={state.query}
          onChange={(event) => setState((prev) => ({ ...prev, query: event.target.value }))}
        />
      </div>
      <div className={css.fmActions}>
        <button type="button" className={css.fmButton} onClick={() => void createFile()}>{t('fm.newFile')}</button>
        <button type="button" className={css.fmButton} onClick={() => void createFolder()}>{t('fm.newFolder')}</button>
        <button type="button" className={css.fmButton} onClick={() => void paste()} disabled={state.clipboard === undefined}>{t('fm.paste')}</button>
        <span className={css.fmSpacer} />
        {selectedEntry !== undefined && (
          <span className={css.fmDetail}>
            {selectedEntry.name} · {selectedEntry.kind === 'dir' ? '—' : formatSize(selectedEntry.size)} · {formatTime(selectedEntry.mtime)}
          </span>
        )}
      </div>
      <div className={css.fmHead}>
        <button type="button" className={css.fmHeadCell} onClick={() => cycleSort('name')}>
          {t('fm.name')}{state.sortKey === 'name' ? (state.sortAsc ? ' ^' : ' v') : ''}
        </button>
        <button type="button" className={css.fmHeadSize} onClick={() => cycleSort('size')}>
          {t('fm.size')}{state.sortKey === 'size' ? (state.sortAsc ? ' ^' : ' v') : ''}
        </button>
        <button type="button" className={css.fmHeadTime} onClick={() => cycleSort('mtime')}>
          {t('fm.modified')}{state.sortKey === 'mtime' ? (state.sortAsc ? ' ^' : ' v') : ''}
        </button>
        <span className={css.fmHeadActions} />
      </div>
      {state.error !== undefined && <div className={css.fmError}>{state.error}</div>}
      <div className={css.fmList} onKeyDown={onListKeyDown} tabIndex={0}>
        {visibleEntries.length === 0 && !state.loading && (
          <div className={css.fmEmpty}>{state.query === '' ? t('fm.empty') : t('fm.searchPlaceholder')}</div>
        )}
        {visibleEntries.map((entry) => (
          <div
            key={entry.path}
            className={[css.fmRow, state.selected === entry.path ? css.fmRowSelected : ''].join(' ')}
            onClick={() => setState((prev) => ({ ...prev, selected: entry.path }))}
            onDoubleClick={() => void openEntry(entry)}
          >
            <button type="button" className={css.fmRowMain} onClick={() => { setState((prev) => ({ ...prev, selected: entry.path })); void openEntry(entry) }}>
              <span className={[css.fmIcon, entry.kind === 'dir' ? css.fmIconDir : css.fmIconFile].join(' ')} aria-hidden="true" />
              <span className={css.fmName}>{entry.name}</span>
              <span className={css.fmMetaSize}>{entry.kind === 'dir' ? '—' : formatSize(entry.size)}</span>
              <span className={css.fmMetaTime}>{formatTime(entry.mtime)}</span>
            </button>
            <div className={css.fmRowActions}>
              <button type="button" className={css.fmMini} title={t('fm.rename')} onClick={() => void renameEntry(entry)}>R</button>
              <button type="button" className={css.fmMini} title={t('fm.copy')} onClick={() => copyEntry(entry)}>C</button>
              <button type="button" className={css.fmMini} title={t('fm.move')} onClick={() => cutEntry(entry)}>M</button>
              <button type="button" className={[css.fmMini, css.fmMiniDanger].join(' ')} title={t('fm.delete')} onClick={() => void deleteEntry(entry)}>D</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

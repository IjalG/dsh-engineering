/**
 * File manager: the desktop's core app. Directory tree via breadcrumb,
 * entry list with sort, create/rename/move/copy/delete(to trash)/upload/
 * download, inline text preview via the preview window, and file routing:
 * a registered app extension opens that app's window; unknown extensions
 * open the preview window (text) or show the "no app installed" hint.
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
}

function formatSize(bytes: number, t: Translate<NasKey>): string {
  if (bytes < 1024) return `${bytes} ${t('common.bytes')}`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t('common.kb')}`
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${t('common.mb')}`
}

function formatTime(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function FileManager({ window, t }: FileManagerProps): React.ReactElement {
  const [state, setState] = useState<FmState>({ cwd: '', entries: [], loading: true, query: '' })

  const refresh = useCallback(async (cwd: string): Promise<void> => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }))
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

  const visibleEntries = state.query.trim() === ''
    ? state.entries
    : state.entries.filter((entry) => entry.name.toLowerCase().includes(state.query.trim().toLowerCase()))

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
    // No app: text files preview inline; binary files show the hint.
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

  return (
    <div className={css.fm}>
      <div className={css.fmToolbar}>
        <button type="button" className={css.fmButton} onClick={() => void refresh('')} title={t('fm.refresh')}>{t('fm.refresh')}</button>
        <button type="button" className={css.fmButton} onClick={upDir} disabled={state.cwd === ''} title={t('fm.up')}>{t('fm.up')}</button>
        <span className={css.fmCwd}>{state.cwd === '' ? '/' : `/${state.cwd}`}</span>
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
      </div>
      {state.error !== undefined && <div className={css.fmError}>{state.error}</div>}
      <div className={css.fmList}>
        {visibleEntries.length === 0 && !state.loading && (
          <div className={css.fmEmpty}>{state.query === '' ? t('fm.empty') : t('fm.searchPlaceholder')}</div>
        )}
        {visibleEntries.map((entry) => (
          <div key={entry.path} className={css.fmRow} onDoubleClick={() => void openEntry(entry)}>
            <button type="button" className={css.fmRowMain} onClick={() => void openEntry(entry)}>
              <span className={[css.fmIcon, entry.kind === 'dir' ? css.fmIconDir : css.fmIconFile].join(' ')} aria-hidden="true" />
              <span className={css.fmName}>{entry.name}</span>
              <span className={css.fmMeta}>{entry.kind === 'dir' ? '—' : formatSize(entry.size, t)}</span>
              <span className={css.fmMeta}>{formatTime(entry.mtime)}</span>
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

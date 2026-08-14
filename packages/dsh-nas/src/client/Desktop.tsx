/**
 * The two-state desktop: fullscreen (icon grid + windows + taskbar) and
 * sidebar-embedded panel (icon rail + windows floating over the viewport).
 * Both share the same window state; only layout density differs. The window
 * layer renders system apps and software-registered app windows.
 */

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NasKey } from './locales.ts'
import type { NasAppMeta } from '../protocol.ts'
import { desktopStore, type DesktopSnapshot, type NasWindow } from './store.ts'
import { WindowFrame } from './WindowFrame.tsx'
import css from './desktop.module.css'

/**
 * Right-side occupied width from sibling family panels (dsh-web-ui's
 * aionui-panel explorer/preview columns). The desktop docks LEFT of them so
 * the two never overlap. Measured live; collapses to 0 when closed.
 */
const AIONUI_COLS = ['[data-aionui-explorer-col]', '[data-aionui-preview-col]']
const HANDLE_Y_KEY = 'dsh.nas.handleY'

/** Measure the width the aionui-panel columns currently occupy. */
function aionuiRightInset(): number {
  let total = 0
  for (const selector of AIONUI_COLS) {
    const el = document.querySelector<HTMLElement>(selector)
    if (el === null) continue
    const rect = el.getBoundingClientRect()
    if (rect.width > 4) total += rect.width
  }
  return total
}

/** Live right inset: re-measures on aionui column style changes and resize. */
function useRightInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const measure = (): void => setInset(aionuiRightInset())
    measure()
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  return inset
}

/** Persisted dock-handle vertical position (fraction of viewport height, 0-1). */
function useHandleY(): [number, (y: number) => void] {
  const [y, setY] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(HANDLE_Y_KEY)
      const parsed = raw === null ? NaN : Number(raw)
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.5
    } catch {
      return 0.5
    }
  })
  const set = useCallback((next: number): void => {
    setY(next)
    try { localStorage.setItem(HANDLE_Y_KEY, String(next)) } catch { /* best effort */ }
  }, [])
  return [y, set]
}

/** 16px stroke-style inline icons (no emoji, no external CDN). */
const ICONS: Record<string, string> = {
  files: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5h4l1.5 2H14v6.5H2z"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h10M6 5V3.5h4V5M4.5 5l.7 7.5h5.6l.7-7.5"/></svg>',
  settings: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 2.2v2M8 11.8v2M2.2 8h2M11.8 8h2M3.9 3.9l1.4 1.4M10.7 10.7l1.4 1.4M12.1 3.9l-1.4 1.4M5.3 10.7l-1.4 1.4"/></svg>',
  search: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4"/><path d="M10.5 10.5L14 14"/></svg>',
}

function systemIcon(kind: string): string {
  return ICONS[kind] ?? ICONS.files
}

export interface DesktopProps {
  t: Translate<NasKey>
}

/** Window layer shared by both modes. */
function WindowLayer({ snapshot, t }: { snapshot: DesktopSnapshot; t: Translate<NasKey> }): React.ReactElement {
  const visible = snapshot.windows.filter((item) => !item.minimized)
  return (
    <div className={css.windowLayer}>
      {visible.map((window) => <WindowFrame key={window.id} window={window} t={t} />)}
    </div>
  )
}

/** One desktop icon (system app or registered software). */
function DesktopIcon({ app, t }: { app: NasAppMeta; t: Translate<NasKey> }): React.ReactElement {
  return (
    <button
      type="button"
      className={css.desktopIcon}
      onClick={() => desktopStore.openWindow(app.windowKind, app.name)}
      title={app.description ?? app.name}
    >
      <span
        className={css.desktopIconGlyph}
        dangerouslySetInnerHTML={{ __html: app.icon !== '' ? app.icon : systemIcon(app.windowKind) }}
      />
      <span className={css.desktopIconLabel}>{app.name}</span>
    </button>
  )
}

/** Taskbar (fullscreen mode): launcher, running windows, mode switch. */
function Taskbar({ snapshot, t }: { snapshot: DesktopSnapshot; t: Translate<NasKey> }): React.ReactElement {
  const [clock, setClock] = useState('')
  useEffect(() => {
    const update = (): void => {
      const now = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      setClock(`${pad(now.getHours())}:${pad(now.getMinutes())}`)
    }
    update()
    const timer = setInterval(update, 30000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className={css.taskbar}>
      <button type="button" className={css.taskbarButton} onClick={() => desktopStore.openWindow('files', t('app.files'))}>
        <span className={css.taskbarGlyph} dangerouslySetInnerHTML={{ __html: systemIcon('files') }} />
      </button>
      <div className={css.taskbarWindows}>
        {snapshot.windows.map((window) => (
          <button
            key={window.id}
            type="button"
            className={[css.taskbarItem, window.minimized ? css.taskbarItemMin : ''].join(' ')}
            onClick={() => desktopStore.focusWindow(window.id)}
          >
            {window.title}
          </button>
        ))}
      </div>
      <span className={css.taskbarClock}>{clock}</span>
      <button type="button" className={css.taskbarButton} onClick={() => desktopStore.setMode('panel')} title={t('desktop.shrink')}>
        <span className={css.taskbarGlyph} dangerouslySetInnerHTML={{ __html: systemIcon('settings') }} />
      </button>
    </div>
  )
}

/** Fullscreen desktop: icon grid + window layer + taskbar. */
function FullscreenDesktop({ snapshot, t }: { snapshot: DesktopSnapshot; t: Translate<NasKey> }): React.ReactElement {
  const icons = [
    ...[{ id: 'files', name: t('app.files'), icon: '', fileExts: [], windowKind: 'files', packageName: 'dsh-nas' },
      { id: 'trash', name: t('app.trash'), icon: '', fileExts: [], windowKind: 'trash', packageName: 'dsh-nas' },
      { id: 'search', name: t('app.search'), icon: '', fileExts: [], windowKind: 'search', packageName: 'dsh-nas' },
      { id: 'settings', name: t('app.settings'), icon: '', fileExts: [], windowKind: 'settings', packageName: 'dsh-nas' }],
    ...snapshot.apps,
  ]
  return (
    <div className={[css.desktop, css.desktopFull].join(' ')} data-nas-desktop="full">
      <div className={css.desktopGrid}>
        {icons.map((app) => <DesktopIcon key={app.id} app={app} t={t} />)}
      </div>
      <WindowLayer snapshot={snapshot} t={t} />
      <Taskbar snapshot={snapshot} t={t} />
    </div>
  )
}

/** Sidebar-embedded panel: icon rail + windows floating over the viewport. */
function PanelDesktop({ snapshot, t }: { snapshot: DesktopSnapshot; t: Translate<NasKey> }): React.ReactElement {
  const inset = useRightInset()
  const icons = [
    ...[{ id: 'files', name: t('app.files'), icon: '', fileExts: [], windowKind: 'files', packageName: 'dsh-nas' },
      { id: 'trash', name: t('app.trash'), icon: '', fileExts: [], windowKind: 'trash', packageName: 'dsh-nas' },
      { id: 'search', name: t('app.search'), icon: '', fileExts: [], windowKind: 'search', packageName: 'dsh-nas' },
      { id: 'settings', name: t('app.settings'), icon: '', fileExts: [], windowKind: 'settings', packageName: 'dsh-nas' }],
    ...snapshot.apps,
  ]
  return (
    <div className={[css.desktop, css.desktopPanel].join(' ')} style={{ right: inset }} data-nas-desktop="panel">
      <div className={css.panelHeader}>
        <span className={css.panelTitle}>{t('desktop.title')}</span>
        <span className={css.fmSpacer} />
        <button type="button" className={css.panelButton} title={t('desktop.expand')} onClick={() => desktopStore.setMode('fullscreen')}>
          {t('desktop.expand')}
        </button>
        <button type="button" className={css.panelButton} title={t('desktop.close')} onClick={() => desktopStore.closeDesktop()}>
          ×
        </button>
      </div>
      <div className={css.panelRail}>
        {icons.map((app) => <DesktopIcon key={app.id} app={app} t={t} />)}
      </div>
      <div className={css.panelWindows}>
        <WindowLayer snapshot={snapshot} t={t} />
      </div>
      <button type="button" className={css.panelHandle} title={t('desktop.shrink')} onClick={() => desktopStore.closeDesktop()}>
        <span className={css.panelHandleGlyph} />
      </button>
    </div>
  )
}

/** Right-edge handle shown while the desktop is closed — draggable along the edge. */
function DockHandle({ t }: { t: Translate<NasKey> }): React.ReactElement {
  const inset = useRightInset()
  const [y, setY] = useHandleY()
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startY: number; baseY: number } | null>(null)

  const onPointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { startY: event.clientY, baseY: y }
    setDragging(true)
  }
  const onPointerMove = (event: React.PointerEvent): void => {
    if (dragRef.current === null) return
    const dy = event.clientY - dragRef.current.startY
    const next = Math.min(0.92, Math.max(0.08, dragRef.current.baseY + dy / window.innerHeight))
    setY(next)
  }
  const onPointerUp = (): void => {
    dragRef.current = null
    setDragging(false)
  }

  return (
    <div
      className={[css.dockHandle, dragging ? css.dockHandleDragging : ''].join(' ')}
      style={{ top: `${y * 100}%`, right: inset }}
      role="button"
      tabIndex={0}
      title={t('entry.tooltip')}
      aria-label={t('entry.label')}
      onClick={() => desktopStore.openDesktop()}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') desktopStore.openDesktop() }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <span className={css.dockHandleGlyph} dangerouslySetInnerHTML={{ __html: systemIcon('files') }} />
      <span className={css.dockHandleLabel}>{t('entry.label')}</span>
    </div>
  )
}

/** Desktop root: closed shows only the right-edge dock handle. */
export function Desktop({ t }: DesktopProps): React.ReactElement {
  const snapshot = useSyncExternalStore(desktopStore.subscribe, desktopStore.getSnapshot)
  if (!snapshot.open) {
    return <DockHandle t={t} />
  }
  if (snapshot.mode === 'fullscreen') return <FullscreenDesktop snapshot={snapshot} t={t} />
  return <PanelDesktop snapshot={snapshot} t={t} />
}

/** Export for tests. */
export function windowById(snapshot: DesktopSnapshot, id: string): NasWindow | undefined {
  return snapshot.windows.find((item) => item.id === id)
}

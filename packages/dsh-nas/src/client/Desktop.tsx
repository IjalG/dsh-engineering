/**
 * The desktop: three states share one window model.
 *
 *  - fullscreen: icon grid + window layer + taskbar (bottom), exit via the
 *    top-right restore button or Escape.
 *  - dock (embedded): an Ubuntu-style left dock (app icons + Show
 *    Applications grid) with the window layer floating in the remaining
 *    viewport space — windows never overflow a narrow panel.
 *  - closed: only the right-edge handle remains (draggable along the edge).
 *
 * The right inset (aionui-panel columns) is measured live and applied to the
 * window layer so the desktop never overlaps the dsh-web-ui right panels.
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
 * aionui-panel explorer/preview columns). Measured live; 0 when closed.
 */
const AIONUI_COLS = ['[data-aionui-explorer-col]', '[data-aionui-preview-col]']
const HANDLE_Y_KEY = 'dsh.nas.handleY'
/** Left dock width in px. */
const DOCK_WIDTH = 76

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
  grid: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>',
  collapse: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>',
}

function systemIcon(kind: string): string {
  return ICONS[kind] ?? ICONS.files
}

export interface DesktopProps {
  t: Translate<NasKey>
}

/** System app list (rendered beside registered software apps). */
function systemApps(t: Translate<NasKey>): NasAppMeta[] {
  return [
    { id: 'files', name: t('app.files'), icon: '', fileExts: [], windowKind: 'files', packageName: 'dsh-nas' },
    { id: 'trash', name: t('app.trash'), icon: '', fileExts: [], windowKind: 'trash', packageName: 'dsh-nas' },
    { id: 'search', name: t('app.search'), icon: '', fileExts: [], windowKind: 'search', packageName: 'dsh-nas' },
    { id: 'scheduler', name: t('app.scheduler'), icon: '', fileExts: [], windowKind: 'scheduler', packageName: 'dsh-nas' },
    { id: 'review', name: t('app.review'), icon: '', fileExts: [], windowKind: 'review', packageName: 'dsh-nas' },
    { id: 'settings', name: t('app.settings'), icon: '', fileExts: [], windowKind: 'settings', packageName: 'dsh-nas' },
  ]
}

/** One app icon (dock or grid). */
function AppIcon({ app, t }: { app: NasAppMeta; t: Translate<NasKey> }): React.ReactElement {
  return (
    <button
      type="button"
      className={css.dockIcon}
      onClick={() => desktopStore.openWindow(app.windowKind, app.name)}
      title={app.description ?? app.name}
      aria-label={app.name}
    >
      <span
        className={css.dockIconGlyph}
        dangerouslySetInnerHTML={{ __html: app.icon !== '' ? app.icon : systemIcon(app.windowKind) }}
      />
      <span className={css.dockIconLabel}>{app.name}</span>
    </button>
  )
}

/** Window layer shared by every mode; left = dock offset, right = aionui inset. */
function WindowLayer({ snapshot, t, left, right }: { snapshot: DesktopSnapshot; t: Translate<NasKey>; left: number; right: number }): React.ReactElement {
  const visible = snapshot.windows.filter((item) => !item.minimized)
  return (
    <div className={css.windowLayer} style={{ left, right }}>
      {visible.map((window) => <WindowFrame key={window.id} window={window} t={t} />)}
    </div>
  )
}

/** Taskbar (fullscreen mode): launcher, running windows, restore, clock. */
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
      <button type="button" className={css.taskbarButton} onClick={() => desktopStore.openWindow('files', t('app.files'))} title={t('app.files')}>
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
      <button type="button" className={css.taskbarButton} onClick={() => desktopStore.setMode('panel')} title={t('desktop.shrink')} aria-label={t('desktop.shrink')}>
        <span className={css.taskbarGlyph} dangerouslySetInnerHTML={{ __html: systemIcon('collapse') }} />
      </button>
    </div>
  )
}

/** Fullscreen desktop: icon grid + window layer + taskbar; Esc/restore exits. */
function FullscreenDesktop({ snapshot, t }: { snapshot: DesktopSnapshot; t: Translate<NasKey> }): React.ReactElement {
  const inset = useRightInset()

  // Escape restores the dock mode.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') desktopStore.setMode('panel')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={[css.desktop, css.desktopFull].join(' ')} data-nas-desktop="full">
      <div className={css.fullHeader}>
        <span className={css.fullTitle}>{t('desktop.title')}</span>
        <button
          type="button"
          className={css.fullRestore}
          onClick={() => desktopStore.setMode('panel')}
          title={t('desktop.shrink')}
          aria-label={t('desktop.shrink')}
        >
          <span dangerouslySetInnerHTML={{ __html: systemIcon('collapse') }} />
        </button>
      </div>
      <div className={css.desktopGrid}>
        {[...systemApps(t), ...snapshot.apps].map((app) => <AppIcon key={app.id} app={app} t={t} />)}
      </div>
      <WindowLayer snapshot={snapshot} t={t} left={0} right={inset} />
      <Taskbar snapshot={snapshot} t={t} />
    </div>
  )
}

/** Show Applications grid (Ubuntu-style): every app in a centered grid. */
function ShowApplications({ apps, t, onClose }: { apps: NasAppMeta[]; t: Translate<NasKey>; onClose: () => void }): React.ReactElement {
  return (
    <div className={css.showApps} onClick={onClose} role="presentation">
      <div className={css.showAppsGrid} onClick={(event) => event.stopPropagation()} role="presentation">
        {apps.map((app) => (
          <button
            key={app.id}
            type="button"
            className={css.showApp}
            onClick={() => { desktopStore.openWindow(app.windowKind, app.name); onClose() }}
          >
            <span className={css.showAppGlyph} dangerouslySetInnerHTML={{ __html: app.icon !== '' ? app.icon : systemIcon(app.windowKind) }} />
            <span className={css.showAppName}>{app.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Ubuntu-style left dock: Show Applications + app icons, windows float right. */
function DockDesktop({ snapshot, t }: { snapshot: DesktopSnapshot; t: Translate<NasKey> }): React.ReactElement {
  const inset = useRightInset()
  const [showApps, setShowApps] = useState(false)
  const apps = [...systemApps(t), ...snapshot.apps]

  return (
    <div className={[css.desktop, css.dockDesktop].join(' ')} data-nas-desktop="panel">
      <div className={css.dock} style={{ right: inset }}>
        <button type="button" className={[css.dockButton, css.dockButtonTop].join(' ')} onClick={() => desktopStore.setMode('fullscreen')} title={t('desktop.expand')} aria-label={t('desktop.expand')}>
          <span className={css.dockGlyph} dangerouslySetInnerHTML={{ __html: systemIcon('collapse') }} />
        </button>
        <button type="button" className={css.dockButton} onClick={() => setShowApps((open) => !open)} title={t('taskbar.open')} aria-label={t('taskbar.open')}>
          <span className={css.dockGlyph} dangerouslySetInnerHTML={{ __html: systemIcon('grid') }} />
        </button>
        <div className={css.dockSeparator} />
        {apps.map((app) => (
          <button
            key={app.id}
            type="button"
            className={css.dockButton}
            onClick={() => desktopStore.openWindow(app.windowKind, app.name)}
            title={app.name}
            aria-label={app.name}
          >
            <span className={css.dockGlyph} dangerouslySetInnerHTML={{ __html: app.icon !== '' ? app.icon : systemIcon(app.windowKind) }} />
          </button>
        ))}
        <div className={css.dockSpacer} />
        <button type="button" className={css.dockButton} onClick={() => desktopStore.closeDesktop()} title={t('desktop.close')} aria-label={t('desktop.close')}>
          <span className={css.dockGlyph} dangerouslySetInnerHTML={{ __html: systemIcon('trash') }} />
        </button>
      </div>
      <WindowLayer snapshot={snapshot} t={t} left={DOCK_WIDTH} right={inset} />
      <DockHandle t={t} open />
      {showApps && <ShowApplications apps={apps} t={t} onClose={() => setShowApps(false)} />}
    </div>
  )
}

/** Right-edge handle — draggable along the edge; toggles the desktop. */
function DockHandle({ t, open }: { t: Translate<NasKey>; open: boolean }): React.ReactElement {
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
      onClick={() => { if (open) desktopStore.closeDesktop(); else desktopStore.openDesktop() }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { if (open) desktopStore.closeDesktop(); else desktopStore.openDesktop() } }}
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
    return <DockHandle t={t} open={false} />
  }
  if (snapshot.mode === 'fullscreen') return <FullscreenDesktop snapshot={snapshot} t={t} />
  return <DockDesktop snapshot={snapshot} t={t} />
}

/** Export for tests. */
export function windowById(snapshot: DesktopSnapshot, id: string): NasWindow | undefined {
  return snapshot.windows.find((item) => item.id === id)
}

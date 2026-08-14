/**
 * The desktop — Ubuntu-style visual design.
 *
 *  - dock (embedded): a translucent dock pinned to the LEFT edge, vertically
 *    centered — Show Applications grid button, app icons with running-dot
 *    indicators, and expand/close controls. Windows float in the remaining
 *    viewport space (never overflowing a narrow panel).
 *  - fullscreen: icon grid + window layer + bottom taskbar; exit via the
 *    top-right restore button or Escape.
 *  - closed: only the right-edge handle (draggable along the edge).
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

const AIONUI_COLS = ['[data-aionui-explorer-col]', '[data-aionui-preview-col]']
const HANDLE_Y_KEY = 'dsh.nas.handleY'
/** Left dock width in px. */
const DOCK_WIDTH = 84

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

/** Width of the DSH sidebar column (0 when not measurable). */
function sidebarWidth(): number {
  const el = document.querySelector<HTMLElement>('[data-pane="sidebar"]')
  if (el === null) return 0
  const rect = el.getBoundingClientRect()
  return rect.width > 4 ? rect.width : 0
}

/** Live sidebar width: the dock docks right of the DSH sidebar. */
function useSidebarWidth(): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const measure = (): void => setWidth(sidebarWidth())
    measure()
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  return width
}

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

/* ------------------------------------------------------------------ icons */

/** Refined 24px stroke icons (no emoji, no external CDN). */
const ICONS: Record<string, { svg: string; color: string }> = {
  files: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4.2a1 1 0 0 1 .8.4l1.4 1.8h7.6a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2z"/></svg>',
    color: '#f59e0b',
  },
  trash: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12M10 11v6M14 11v6"/></svg>',
    color: '#64748b',
  },
  search: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
    color: '#0ea5e9',
  },
  scheduler: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    color: '#8b5cf6',
  },
  review: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M8.5 8h8M8.5 12h8M8.5 16h5"/></svg>',
    color: '#10b981',
  },
  settings: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/></svg>',
    color: '#64748b',
  },
  grid: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    color: '#3b82f6',
  },
  expand: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>',
    color: '#3b82f6',
  },
  collapse: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8H4v5M15 8h5v5M9 16H4v-5M15 16h5v-5"/></svg>',
    color: '#3b82f6',
  },
  close: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    color: '#ef4444',
  },
  file: {
    svg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14 3.5V8h4"/></svg>',
    color: '#3b82f6',
  },
}

/** Icon for one app kind (falls back to the file icon). */
function appIcon(kind: string): { svg: string; color: string } {
  return ICONS[kind] ?? ICONS.file!
}

function systemIconHtml(kind: string): string {
  const icon = appIcon(kind)
  return `<span style="color:${icon.color};display:inline-flex">${icon.svg}</span>`
}

/** Extract the active session id from any session-store snapshot shape. */
function extractSessionId(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const snapshot = state as Record<string, unknown>
  for (const key of ['recentSessionId', 'activeSessionId', 'currentSessionId', 'sessionId']) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  const sessions = snapshot.sessions
  if (Array.isArray(sessions) && sessions.length > 0) {
    const first = sessions[0] as Record<string, unknown> | undefined
    if (first !== undefined && typeof first.id === 'string' && first.id !== '') return first.id
  }
  return undefined
}

export interface DesktopProps {
  t: Translate<NasKey>
  /** Shell-standard session selector hook (slot standard prop). */
  useSessions?: (selector: (state: unknown) => unknown) => unknown
}

/** System apps (rendered beside registered software apps). */
function systemApps(t: Translate<NasKey>): NasAppMeta[] {
  return [
    { id: 'files', name: t('app.files'), icon: '', fileExts: [], windowKind: 'files', packageName: 'dsh-nas' },
    { id: 'search', name: t('app.search'), icon: '', fileExts: [], windowKind: 'search', packageName: 'dsh-nas' },
    { id: 'review', name: t('app.review'), icon: '', fileExts: [], windowKind: 'review', packageName: 'dsh-nas' },
    { id: 'scheduler', name: t('app.scheduler'), icon: '', fileExts: [], windowKind: 'scheduler', packageName: 'dsh-nas' },
    { id: 'trash', name: t('app.trash'), icon: '', fileExts: [], windowKind: 'trash', packageName: 'dsh-nas' },
    { id: 'settings', name: t('app.settings'), icon: '', fileExts: [], windowKind: 'settings', packageName: 'dsh-nas' },
  ]
}

/** App glyph (registered software icon or the system icon). */
function AppGlyph({ app }: { app: NasAppMeta }): React.ReactElement {
  const icon = app.icon !== '' ? { svg: app.icon, color: 'currentColor' } : appIcon(app.windowKind)
  return (
    <span
      className={css.glyph}
      style={{ color: icon.color }}
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  )
}

/** Dock icon: icon + running indicator dot + tooltip label. */
function DockItem({ app, running }: { app: NasAppMeta; running: boolean }): React.ReactElement {
  return (
    <button
      type="button"
      className={css.dockItem}
      onClick={() => desktopStore.openWindow(app.windowKind, app.name)}
      aria-label={app.name}
    >
      <AppGlyph app={app} />
      <span className={css.dockTooltip}>{app.name}</span>
      <span className={[css.dockDot, running ? css.dockDotOn : ''].join(' ')} aria-hidden="true" />
    </button>
  )
}

/* --------------------------------------------------------------- window layer */

function WindowLayer({ snapshot, t, left, right }: { snapshot: DesktopSnapshot; t: Translate<NasKey>; left: number; right: number }): React.ReactElement {
  const visible = snapshot.windows.filter((item) => !item.minimized)
  return (
    <div className={css.windowLayer} style={{ left, right }}>
      {visible.map((window) => <WindowFrame key={window.id} window={window} t={t} />)}
    </div>
  )
}

/* ---------------------------------------------------------------- taskbar */

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

  const windowApps = snapshot.windows.map((window) => {
    const app = [...systemApps(t), ...snapshot.apps].find((item) => item.windowKind === window.kind)
    return { window, app: app ?? { id: window.kind, name: window.title, icon: '', fileExts: [], windowKind: window.kind, packageName: '' } }
  })

  return (
    <div className={css.taskbar}>
      <div className={css.taskbarInner}>
        {windowApps.map(({ window, app }) => (
          <button
            key={window.id}
            type="button"
            className={[css.taskItem, window.minimized ? css.taskItemMin : ''].join(' ')}
            onClick={() => desktopStore.focusWindow(window.id)}
            aria-label={window.title}
          >
            <AppGlyph app={app} />
            <span className={css.taskTooltip}>{window.title}</span>
          </button>
        ))}
      </div>
      <span className={css.taskClock}>{clock}</span>
      <button type="button" className={css.taskControl} onClick={() => desktopStore.setMode('panel')} title={t('desktop.shrink')} aria-label={t('desktop.shrink')}>
        <span dangerouslySetInnerHTML={{ __html: ICONS.collapse!.svg }} />
      </button>
    </div>
  )
}

/* -------------------------------------------------------------- fullscreen */

function FullscreenDesktop({ snapshot, t }: { snapshot: DesktopSnapshot; t: Translate<NasKey> }): React.ReactElement {
  const inset = useRightInset()

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
        <span className={css.fullBrand}>
          <span className={css.fullBrandDot} aria-hidden="true" />
          {t('desktop.title')}
        </span>
        <button
          type="button"
          className={css.fullRestore}
          onClick={() => desktopStore.setMode('panel')}
          title={t('desktop.shrink')}
          aria-label={t('desktop.shrink')}
        >
          <span dangerouslySetInnerHTML={{ __html: ICONS.collapse!.svg }} />
        </button>
      </div>
      <div className={css.desktopGrid}>
        {[...systemApps(t), ...snapshot.apps].map((app) => (
          <button
            key={app.id}
            type="button"
            className={css.gridIcon}
            onClick={() => desktopStore.openWindow(app.windowKind, app.name)}
            title={app.description ?? app.name}
            aria-label={app.name}
          >
            <AppGlyph app={app} />
            <span className={css.gridIconLabel}>{app.name}</span>
          </button>
        ))}
      </div>
      <WindowLayer snapshot={snapshot} t={t} left={0} right={inset} />
      <Taskbar snapshot={snapshot} t={t} />
    </div>
  )
}

/* ---------------------------------------------------------- show applications */

function ShowApplications({ apps, t, onClose }: { apps: NasAppMeta[]; t: Translate<NasKey>; onClose: () => void }): React.ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={css.showApps} onClick={onClose} role="presentation">
      <div className={css.showAppsPanel} onClick={(event) => event.stopPropagation()} role="presentation">
        <div className={css.showAppsTitle}>{t('taskbar.open')}</div>
        <div className={css.showAppsGrid}>
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              className={css.showApp}
              onClick={() => { desktopStore.openWindow(app.windowKind, app.name); onClose() }}
            >
              <AppGlyph app={app} />
              <span className={css.showAppName}>{app.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- dock */

function DockDesktop({ snapshot, t }: { snapshot: DesktopSnapshot; t: Translate<NasKey> }): React.ReactElement {
  const inset = useRightInset()
  const sidebarW = useSidebarWidth()
  const [showApps, setShowApps] = useState(false)
  const apps = [...systemApps(t), ...snapshot.apps]
  const runningKinds = new Set(snapshot.windows.map((window) => window.kind))

  return (
    <div className={[css.desktop, css.dockDesktop].join(' ')} data-nas-desktop="panel">
      <div className={css.dock} style={{ left: sidebarW + 10 }}>
        <button type="button" className={css.dockItem} onClick={() => setShowApps((open) => !open)} aria-label={t('taskbar.open')} title={t('taskbar.open')}>
          <span className={css.glyph} style={{ color: ICONS.grid!.color }} dangerouslySetInnerHTML={{ __html: ICONS.grid!.svg }} />
          <span className={css.dockTooltip}>{t('taskbar.open')}</span>
        </button>
        <div className={css.dockSeparator} />
        {apps.map((app) => <DockItem key={app.id} app={app} running={runningKinds.has(app.windowKind)} />)}
        <div className={css.dockSeparator} />
        <button type="button" className={css.dockItem} onClick={() => desktopStore.setMode('fullscreen')} aria-label={t('desktop.expand')} title={t('desktop.expand')}>
          <span className={css.glyph} style={{ color: ICONS.expand!.color }} dangerouslySetInnerHTML={{ __html: ICONS.expand!.svg }} />
          <span className={css.dockTooltip}>{t('desktop.expand')}</span>
        </button>
        <button type="button" className={css.dockItem} onClick={() => desktopStore.closeDesktop()} aria-label={t('desktop.close')} title={t('desktop.close')}>
          <span className={css.glyph} style={{ color: ICONS.close!.color }} dangerouslySetInnerHTML={{ __html: ICONS.close!.svg }} />
          <span className={css.dockTooltip}>{t('desktop.close')}</span>
        </button>
      </div>
      <WindowLayer snapshot={snapshot} t={t} left={sidebarW + DOCK_WIDTH} right={inset} />
      {showApps && <ShowApplications apps={apps} t={t} onClose={() => setShowApps(false)} />}
    </div>
  )
}

/* ----------------------------------------------------------- right-edge handle */

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
    const next = Math.min(0.94, Math.max(0.06, dragRef.current.baseY + dy / window.innerHeight))
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
      <span className={css.handleGlyph} dangerouslySetInnerHTML={{ __html: systemIconHtml('files') }} />
      <span className={css.handleLabel}>{t('entry.label')}</span>
    </div>
  )
}

/** Desktop root: closed shows only the right-edge dock handle. */
export function Desktop({ t, useSessions }: DesktopProps): React.ReactElement {
  const snapshot = useSyncExternalStore(desktopStore.subscribe, desktopStore.getSnapshot)

  // Feed the active session id into the desktop store (workspace-rooted
  // filesystem calls resolve against the real session cwd).
  const sessionId = useSessions !== undefined ? (useSessions((state) => extractSessionId(state)) as string | undefined) : undefined
  useEffect(() => {
    desktopStore.setActiveSessionId(sessionId)
  }, [sessionId])

  if (!snapshot.open) {
    return <DockHandle t={t} />
  }
  if (snapshot.mode === 'fullscreen') return <FullscreenDesktop snapshot={snapshot} t={t} />
  return <DockDesktop snapshot={snapshot} t={t} />
}

/** Export for tests. */
export function windowById(snapshot: DesktopSnapshot, id: string): NasWindow | undefined {
  return snapshot.windows.find((item) => item.id === id)
}

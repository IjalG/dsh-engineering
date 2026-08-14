/**
 * Window frame: title bar (icon, title, minimize/maximize/close), drag to
 * move, corner resize, maximize toggle, z-order focus. Content is dispatched
 * by kind: system kinds render the desktop's own apps; app kinds render the
 * component a software package registered via nasClient.
 */

import React, { useRef, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NasKey } from './locales.ts'
import type { NasWindow } from './store.ts'
import { desktopStore } from './store.ts'
import { FileManager } from './FileManager.tsx'
import { Preview } from './Preview.tsx'
import { SettingsApp } from './SettingsApp.tsx'
import { TrashApp } from './TrashApp.tsx'
import { SearchApp } from './SearchApp.tsx'
import { SchedulerApp } from './SchedulerApp.tsx'
import { ReviewApp } from './ReviewApp.tsx'
import css from './desktop.module.css'

export interface WindowFrameProps {
  window: NasWindow
  t: Translate<NasKey>
}

/** Render the content of one window by kind. */
function WindowContent({ window, t }: WindowFrameProps): React.ReactElement | null {
  if (window.kind === 'files') return <FileManager window={window} t={t} />
  if (window.kind === 'trash') return <TrashApp window={window} t={t} />
  if (window.kind === 'settings') return <SettingsApp window={window} t={t} />
  if (window.kind === 'search') return <SearchApp window={window} t={t} />
  if (window.kind === 'scheduler') return <SchedulerApp window={window} t={t} />
  if (window.kind === 'review') return <ReviewApp window={window} t={t} />
  // Text-file preview window (editable when the extension is text).
  if (window.kind === 'preview') return <Preview window={window} t={t} />
  // App window registered by a software package.
  const AppComponent = desktopStore.getSnapshot().appWindows.get(window.kind)
  if (AppComponent !== undefined) {
    const sessionId = desktopStore.getSnapshot().activeSessionId
    return <AppComponent window={window} close={() => desktopStore.closeWindow(window.id)} sessionId={sessionId} />
  }
  return <div className={css.windowMissing}>{t('app.unknown')}</div>
}

/** Accent color per window kind (dot before the title). */
const KIND_COLORS: Record<string, string> = {
  files: '#f59e0b', trash: '#64748b', search: '#0ea5e9', scheduler: '#8b5cf6',
  review: '#10b981', settings: '#64748b', preview: '#3b82f6', office: '#3b82f6', mail: '#ef4444',
}

/** Pointer-drag state: move, or one of the eight resize edges/corners. */
type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null

/** Resize edge cursor mapping. */
const EDGE_CURSOR: Record<Exclude<DragMode, 'move' | null>, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
}

const MIN_W = 320
const MIN_H = 200

export function WindowFrame({ window, t }: WindowFrameProps): React.ReactElement {
  const [drag, setDrag] = useState<DragMode>(null)
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; baseW: number; baseH: number } | null>(null)

  const onPointerDown = (mode: DragMode) => (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    desktopStore.focusWindow(window.id)
    dragRef.current = { startX: event.clientX, startY: event.clientY, baseX: window.x, baseY: window.y, baseW: window.w, baseH: window.h }
    setDrag(mode)
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    if (drag === null || dragRef.current === null) return
    const { startX, startY, baseX, baseY, baseW, baseH } = dragRef.current
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (drag === 'move') {
      desktopStore.moveWindow(window.id, baseX + dx, baseY + dy)
      return
    }
    // Resize per edge/corner: adjust the origin for west/north edges and the
    // size for east/south edges, clamping to the minimum.
    let x = baseX
    let y = baseY
    let w = baseW
    let h = baseH
    if (drag.includes('e')) w = Math.max(MIN_W, baseW + dx)
    if (drag.includes('s')) h = Math.max(MIN_H, baseH + dy)
    if (drag.includes('w')) {
      w = Math.max(MIN_W, baseW - dx)
      x = baseX + (baseW - w)
    }
    if (drag.includes('n')) {
      h = Math.max(MIN_H, baseH - dy)
      y = baseY + (baseH - h)
    }
    desktopStore.moveWindow(window.id, x, y)
    desktopStore.resizeWindow(window.id, w, h)
  }

  const onPointerUp = (): void => {
    dragRef.current = null
    setDrag(null)
  }

  const focused = desktopStore.getSnapshot().windows.some((item) =>
    item.id === window.id && item.z === Math.max(...desktopStore.getSnapshot().windows.map((w) => w.z)))

  return (
    <div
      className={[css.window, window.maximized ? css.windowMaximized : '', focused ? css.windowFocused : '', drag !== null ? css.windowDragging : ''].join(' ')}
      style={window.maximized ? undefined : { left: window.x, top: window.y, width: window.w, height: window.h }}
      data-window-id={window.id}
      onPointerDown={() => desktopStore.focusWindow(window.id)}
    >
      <div
        className={css.windowTitlebar}
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <span className={css.windowDot} style={{ background: KIND_COLORS[window.kind] ?? '#3b82f6' }} aria-hidden="true" />
        <span className={css.windowTitle}>{window.title}</span>
        <div className={css.windowControls}>
          <button type="button" className={css.windowButton} aria-label={t('window.minimize')} title={t('window.minimize')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => desktopStore.minimizeWindow(window.id)}>
            <span className={css.winMin} />
          </button>
          <button type="button" className={css.windowButton} aria-label={window.maximized ? t('window.restore') : t('window.maximize')}
            title={window.maximized ? t('window.restore') : t('window.maximize')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => desktopStore.toggleMaximize(window.id)}>
            <span className={css.winMax} />
          </button>
          <button type="button" className={[css.windowButton, css.windowClose].join(' ')} aria-label={t('window.close')} title={t('window.close')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => desktopStore.closeWindow(window.id)}>
            <span className={css.winClose} />
          </button>
        </div>
      </div>
      <div className={css.windowBody}>
        <WindowContent window={window} t={t} />
      </div>
      {!window.maximized && (
        <>
          <div className={[css.windowEdge, css.edgeN].join(' ')} style={{ cursor: EDGE_CURSOR.n }} onPointerDown={onPointerDown('n')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
          <div className={[css.windowEdge, css.edgeS].join(' ')} style={{ cursor: EDGE_CURSOR.s }} onPointerDown={onPointerDown('s')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
          <div className={[css.windowEdge, css.edgeE].join(' ')} style={{ cursor: EDGE_CURSOR.e }} onPointerDown={onPointerDown('e')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
          <div className={[css.windowEdge, css.edgeW].join(' ')} style={{ cursor: EDGE_CURSOR.w }} onPointerDown={onPointerDown('w')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
          <div className={[css.windowEdge, css.edgeNE].join(' ')} style={{ cursor: EDGE_CURSOR.ne }} onPointerDown={onPointerDown('ne')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
          <div className={[css.windowEdge, css.edgeNW].join(' ')} style={{ cursor: EDGE_CURSOR.nw }} onPointerDown={onPointerDown('nw')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
          <div className={[css.windowEdge, css.edgeSE].join(' ')} style={{ cursor: EDGE_CURSOR.se }} onPointerDown={onPointerDown('se')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
          <div className={[css.windowEdge, css.edgeSW].join(' ')} style={{ cursor: EDGE_CURSOR.sw }} onPointerDown={onPointerDown('sw')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
        </>
      )}
    </div>
  )
}

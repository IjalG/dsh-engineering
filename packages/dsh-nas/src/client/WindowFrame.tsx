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
  // Text-file preview window (editable when the extension is text).
  if (window.kind === 'preview') return <Preview window={window} t={t} />
  // App window registered by a software package.
  const AppComponent = desktopStore.getSnapshot().appWindows.get(window.kind)
  if (AppComponent !== undefined) {
    return <AppComponent window={window} close={() => desktopStore.closeWindow(window.id)} />
  }
  return <div className={css.windowMissing}>{t('app.unknown')}</div>
}

/** Pointer-drag state for the frame. */
type DragMode = 'move' | 'resize' | null

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
    } else {
      desktopStore.resizeWindow(window.id, Math.max(320, baseW + dx), Math.max(200, baseH + dy))
    }
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
      <div className={css.windowResize} onPointerDown={onPointerDown('resize')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
    </div>
  )
}

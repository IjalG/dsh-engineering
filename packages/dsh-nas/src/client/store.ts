/**
 * Desktop store: window manager state + app registry mirror + mode. A tiny
 * immutable subscription store (useSyncExternalStore-compatible) with zero
 * dependencies. Software packages register window components through the
 * `nasClient` service (see index.ts); the store keeps the component map.
 */

import type { ComponentType } from 'react'
import type { NasAppMeta } from '../protocol.ts'

/** One open desktop window. */
export interface NasWindow {
  id: string
  /** Window kind: a registered app windowKind, or a system kind. */
  kind: string
  title: string
  /** File window target (workspace-relative path). */
  path?: string
  /** Whether a text file may be edited in place (write button). */
  editable?: boolean
  x: number
  y: number
  w: number
  h: number
  minimized: boolean
  maximized: boolean
  z: number
}

/** System window kinds rendered by the desktop itself. */
export type SystemKind = 'files' | 'trash' | 'settings' | 'search'

export interface DesktopSnapshot {
  open: boolean
  mode: 'panel' | 'fullscreen'
  windows: NasWindow[]
  apps: NasAppMeta[]
  /** Registered app window components (kind -> component). */
  appWindows: ReadonlyMap<string, ComponentType<AppWindowProps>>
}

export interface AppWindowProps {
  window: NasWindow
  /** Close this window. */
  close: () => void
}

const SYSTEM_KINDS: readonly SystemKind[] = ['files', 'trash', 'settings', 'search']

/** Immutable store. */
class DesktopStore {
  private state: DesktopSnapshot = {
    open: false,
    mode: 'panel',
    windows: [],
    apps: [],
    appWindows: new Map(),
  }

  private listeners = new Set<() => void>()
  private zCounter = 1
  private windowCounter = 1

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): DesktopSnapshot => this.state

  private set(patch: Partial<DesktopSnapshot>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  // ---- desktop ----

  openDesktop(): void {
    if (this.state.open) return
    this.set({ open: true })
  }

  closeDesktop(): void {
    this.set({ open: false })
  }

  toggleDesktop(): void {
    if (this.state.open) this.closeDesktop()
    else this.openDesktop()
  }

  setMode(mode: 'panel' | 'fullscreen'): void {
    this.set({ mode })
  }

  setApps(apps: NasAppMeta[]): void {
    this.set({ apps })
  }

  // ---- windows ----

  private baseRect(): { x: number; y: number; w: number; h: number } {
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
    const panel = this.state.mode === 'panel'
    const w = panel ? Math.min(640, Math.round(viewportW * 0.9)) : Math.round(viewportW * 0.62)
    const h = panel ? Math.min(420, Math.round(viewportH * 0.72)) : Math.round(viewportH * 0.72)
    const x = panel ? Math.max(8, Math.round((viewportW - w) / 2)) : Math.round((viewportW - w) / 2)
    const y = panel ? 48 : Math.round((viewportH - h) / 2)
    return { x, y, w, h }
  }

  openWindow(kind: string, title: string, options: { path?: string; editable?: boolean } = {}): void {
    const existing = this.state.windows.find((item) => item.kind === kind && item.path === options.path)
    if (existing !== undefined) {
      this.focusWindow(existing.id)
      return
    }
    const rect = this.baseRect()
    const window: NasWindow = {
      id: `nas-w-${this.windowCounter++}`,
      kind,
      title,
      path: options.path,
      editable: options.editable,
      ...rect,
      minimized: false,
      maximized: false,
      z: this.zCounter++,
    }
    this.set({ windows: [...this.state.windows, window] })
  }

  closeWindow(id: string): void {
    this.set({ windows: this.state.windows.filter((item) => item.id !== id) })
  }

  focusWindow(id: string): void {
    const target = this.state.windows.find((item) => item.id === id)
    if (target === undefined || target.z === this.zCounter - 1 && !target.minimized) {
      if (target !== undefined && target.minimized) {
        this.set({ windows: this.state.windows.map((item) => item.id === id ? { ...item, minimized: false, z: this.zCounter++ } : item) })
      }
      return
    }
    this.set({
      windows: this.state.windows.map((item) =>
        item.id === id ? { ...item, minimized: false, z: this.zCounter++ } : item),
    })
  }

  minimizeWindow(id: string): void {
    this.set({ windows: this.state.windows.map((item) => item.id === id ? { ...item, minimized: true } : item) })
  }

  toggleMaximize(id: string): void {
    this.set({ windows: this.state.windows.map((item) => item.id === id ? { ...item, maximized: !item.maximized } : item) })
  }

  moveWindow(id: string, x: number, y: number): void {
    this.set({ windows: this.state.windows.map((item) => item.id === id ? { ...item, x, y } : item) })
  }

  resizeWindow(id: string, w: number, h: number): void {
    this.set({ windows: this.state.windows.map((item) => item.id === id ? { ...item, w, h } : item) })
  }

  // ---- app windows (registered by software packages) ----

  registerAppWindow(kind: string, component: ComponentType<AppWindowProps>): () => void {
    const appWindows = new Map(this.state.appWindows)
    appWindows.set(kind, component)
    this.set({ appWindows })
    return () => {
      const next = new Map(this.state.appWindows)
      next.delete(kind)
      this.set({ appWindows: next })
    }
  }

  /** Whether a window kind has a renderer (system kinds always do). */
  hasRenderer(kind: string): boolean {
    if ((SYSTEM_KINDS as readonly string[]).includes(kind)) return true
    return this.state.appWindows.has(kind)
  }
}

/** Singleton store instance. */
export const desktopStore = new DesktopStore()

/** App meta for system apps (rendered beside registered software). */
export function systemApps(): NasAppMeta[] {
  return [
    { id: 'files', name: '我的文件', icon: '', fileExts: [], windowKind: 'files', packageName: 'dsh-nas' },
    { id: 'trash', name: '回收站', icon: '', fileExts: [], windowKind: 'trash', packageName: 'dsh-nas' },
    { id: 'settings', name: '设置', icon: '', fileExts: [], windowKind: 'settings', packageName: 'dsh-nas' },
  ]
}

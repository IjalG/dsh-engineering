/**
 * Browser-half entry for the dsh-nas system package — runs inside the dsh
 * web GUI. Plain TS entry (the shared bundle preset pins the client entry at
 * src/client/index.ts; JSX lives in the .tsx components).
 *
 * Registers:
 *  - the sidebar entry (sidebar.footer.action slot) that toggles the desktop;
 *  - the desktop itself (shell.overlay slot) — fullscreen or panel mode;
 *  - the `nasClient` service: software packages (dsh-office, dsh-mail, ...)
 *    register their app window components here (cross-plugin collaboration
 *    through cordis services, never value imports);
 *  - locale dictionaries.
 *
 * Failure policy: registration problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws.
 *
 * Export discipline (packages/client rule): the /client surface carries what
 * cordis loading needs plus types only — all value exports stay internal.
 */
import { createElement, type ComponentType } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the slots service's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { NasApi } from './api.ts'
import { Desktop } from './Desktop.tsx'
import { en, zh, type NasKey } from './locales.ts'
import { desktopStore } from './store.ts'
import type { AppWindowProps } from './store.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-nas'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-nas surface copy. */
    'dsh-nas': NasKey
  }

  interface SlotMap {
    /** Optional actions beside Settings at the sidebar foot (shell-owned). */
    'sidebar.footer.action': { kind: 'list'; scope: 'root' }
    /** Frame-wide floating layer above every column (shell-owned). */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale']

/** Type-only surface (export discipline). */
export type { AppWindowProps } from './store.ts'
export type { NasKey } from './locales.ts'

/**
 * The nasClient service software packages consume: register an app window
 * renderer by window kind. The host-side counterpart (nas.apps) carries the
 * metadata (icon, extensions, package name).
 */
export interface NasClientService {
  registerAppWindow(kind: string, component: ComponentType<AppWindowProps>): () => void
}

/** Mount the dsh-nas surfaces. */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-nas: dictionaries')
  } catch (error) {
    console.warn('[dsh-nas] locale registration failed:', error)
  }

  const t = (key: NasKey): string => {
    try {
      return ctx.locale.bind(NS)(key)
    } catch {
      return zh[key]
    }
  }

  // Desktop overlay (frame-wide floating layer; renders null while closed).
  try {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'nas-desktop',
      order: 10,
      locale: NS,
    }, () => createElement(Desktop, { t: ctx.locale.bind(NS) })))
  } catch (error) {
    console.warn('[dsh-nas] desktop registration failed:', error)
  }

  // nasClient service for software packages.
  try {
    ctx.provide('nasClient', {
      registerAppWindow: (kind, component) => desktopStore.registerAppWindow(kind, component),
    } satisfies NasClientService)
  } catch (error) {
    console.warn('[dsh-nas] nasClient service failed:', error)
  }

  // Initial sync: apps + prefs from the host.
  const api = new NasApi()
  void api.appsList().then((result) => {
    if (result.ok) desktopStore.setApps(result.apps)
  }).catch((error) => console.warn('[dsh-nas] apps sync failed:', error))
  void api.prefsGet().then((result) => {
    if (result.ok) {
      desktopStore.setMode(result.prefs.mode)
      if (result.prefs.open) desktopStore.openDesktop()
    }
  }).catch((error) => console.warn('[dsh-nas] prefs sync failed:', error))
}

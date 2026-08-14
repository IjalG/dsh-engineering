/**
 * dsh-office — browser half. Registers locale dictionaries and the Office
 * window renderer into the dsh-nas desktop (nasClient service); the host
 * half registers the app metadata (nas.apps).
 */
import { createElement, type ComponentType } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type OfficeKey } from './locales.ts'
import { OfficeWindow, type OfficeWindowProps } from './OfficeWindow.tsx'

/** Locale namespace this plugin owns. */
const NS = 'dsh-office'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-office surface copy. */
    'dsh-office': OfficeKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale']

/** Type-only surface. */
export type { OfficeKey } from './locales.ts'
export type { OfficeWindowProps } from './OfficeWindow.tsx'

/** Mount the office surfaces. */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-office: dictionaries')
  } catch (error) {
    console.warn('[dsh-office] locale registration failed:', error)
  }

  const t = (key: OfficeKey): string => {
    try { return ctx.locale.bind(NS)(key) } catch { return zh[key] }
  }

  // Register the Office window renderer into the dsh-nas desktop.
  try {
    const loose = ctx as unknown as { get(name: string): unknown }
    const nasClient = loose.get('nasClient') as { registerAppWindow(kind: string, component: ComponentType<unknown>): () => void } | undefined
    nasClient?.registerAppWindow('office', ((props: OfficeWindowProps) =>
      createElement(OfficeWindow, { ...props, t: props.t ?? t })) as ComponentType<unknown>)
  } catch (error) {
    console.warn('[dsh-office] nasClient registration failed:', error)
  }
}

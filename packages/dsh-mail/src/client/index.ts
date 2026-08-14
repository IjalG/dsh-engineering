/**
 * dsh-mail — browser half. Registers locale dictionaries and the Mail window
 * renderer into the dsh-nas desktop (nasClient service).
 */
import { createElement, type ComponentType } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type MailKey } from './locales.ts'
import { MailWindow, type MailWindowProps } from './MailWindow.tsx'

/** Locale namespace this plugin owns. */
const NS = 'dsh-mail'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-mail surface copy. */
    'dsh-mail': MailKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale']

/** Type-only surface. */
export type { MailKey } from './locales.ts'
export type { MailWindowProps } from './MailWindow.tsx'

/** Mount the mail surfaces. */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mail: dictionaries')
  } catch (error) {
    console.warn('[dsh-mail] locale registration failed:', error)
  }

  const t = (key: MailKey): string => {
    try { return ctx.locale.bind(NS)(key) } catch { return zh[key] }
  }

  try {
    const loose = ctx as unknown as { get(name: string): unknown }
    const nasClient = loose.get('nasClient') as { registerAppWindow(kind: string, component: ComponentType<unknown>): () => void } | undefined
    nasClient?.registerAppWindow('mail', ((props: MailWindowProps) =>
      createElement(MailWindow, { ...props, t: props.t ?? t })) as ComponentType<unknown>)
  } catch (error) {
    console.warn('[dsh-mail] nasClient registration failed:', error)
  }
}

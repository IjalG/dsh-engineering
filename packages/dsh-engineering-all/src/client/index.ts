/**
 * dsh-engineering family aggregate, browser half. Registers the
 * `engineering-plugins` dictionaries and one group card into the plugin
 * configuration section (设置 > 插件 > 插件配置), right of the dsh-web-ui
 * group. The group card renders the family members with the auto-detection
 * rule (a member already managed by dsh-web-ui is hidden here).
 *
 * The panel only ever READS member state (beyond-workscope overview via its
 * own API); registration and configuration stay with the owning family, so
 * no duplicate loader rows or duplicate config cards can appear.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the slots service's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { EngineeringPluginsCard } from './EngineeringPluginsCard.tsx'
import { en, zh, type EngineeringPluginsKey } from './locales.ts'


declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Engineering family group card copy. */
    'engineering-plugins': EngineeringPluginsKey
  }

  interface SlotMap {
    /**
     * The plugin configuration section's card seat, declared by
     * ui-plugin-config. Spelled here with the same shape so this package can
     * register its group card without depending on the sibling UI packages
     * (which do not publish type surfaces).
     */
    'settings.plugin.item': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

/** Required services. */
export const inject = ['slots', 'locale']

/**
 * Register the engineering plugin group.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('engineering-plugins', { zh, en }), 'dsh-engineering-all: dictionaries')

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'engineering-plugins',
    order: 95,
    locale: 'engineering-plugins',
    inject: () => ({ slots: ctx.slots }),
  }, EngineeringPluginsCard))
}

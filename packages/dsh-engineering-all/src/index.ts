/**
 * Host half of the dsh-engineering family aggregate: no host behavior of its
 * own (the browser half carries the unified management panel registered into
 * 设置 > 插件 > 插件配置). Engineering family plugin rows are aggregated by
 * this package's bundle patch; external members (dsh-beyond-workscope) stay
 * registered by their own family to avoid duplicate loader entries.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Required services: none. */
export const inject = [] as const

/** Host plugin body: nothing to do. */
export function apply(_ctx: Context): void {}

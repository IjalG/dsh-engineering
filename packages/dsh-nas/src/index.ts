/**
 * dsh-nas — host half.
 *
 * The desktop system: workspace-bound file manager API, trash (delete moves
 * into .nas/trash, restorable), operation audit, app registry (software
 * packages register here), and desktop prefs persistence. The browser half
 * renders the two-state desktop (sidebar-embedded / fullscreen) with the
 * window system, file manager, trash, settings and the app launcher.
 *
 * Master switch: the settings section (设置 > 插件 > 插件配置 > 工程面板 or the
 * dsh settings surface) toggles `enabled`. When off, the announcement prompt
 * section and the /api/dsh-nas routes are unregistered — no tokens spent on
 * the desktop's guidance and no file surface served. The switch is live
 * (settings watcher), no restart needed.
 *
 * Everything rides official NPM SDK packages — no dsh source changes.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { AppRegistry, NAS_APPS_SERVICE } from './apps.ts'
import { readConfig, writeConfig, type NasConfigFile } from './config.ts'
import { FsApi, type RootResolver } from './fsapi.ts'
import type { NasPrefs } from './protocol.ts'
import { dataRoutes, managementRoutes, type NasRouteContext } from './routes.ts'
import { dbFor } from './db.ts'
import { SearchIndex } from './search.ts'
import { TaskScheduler } from './scheduler.ts'
import { Notifier } from './notify.ts'

/** Stable cordis plugin name. */
export const name = 'dsh-nas'

/** Services required before the surfaces can mount. */
export const inject = ['webServer', 'systemPrompt']

/**
 * Settings namespace of the capability — the section the web settings
 * surface edits. Spelled here rather than imported: the browser half spells
 * the same value and must not depend on a Host package.
 */
export const NAS_NS = settingsNamespace('dsh-nas')

/** Plugin config: master switch + agent announcement. */
export interface Config {
  /** Master switch. When false, prompt section and routes are unregistered. */
  enabled?: boolean
  /** Whether the model-facing announcement section is injected (token cost). */
  announceToAgent?: boolean
}

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 165

/** Model-facing announcement: desktop presence, file API discipline. */
export const NAS_GUIDANCE = [
  '本机已安装 dsh-nas 插件（仿 OS 办公桌面工作台）：侧边栏「工作台」入口可打开内嵌/全屏桌面，根目录即会话工作区。',
  '用户可能在桌面里管理文件、预览或编辑文档（Word/Excel/PPT/PDF 由 dsh-office 等软件包提供）。',
  '文件管理 API 语义：删除进回收站（.nas/trash）可恢复；所有写操作有审计；.nas 系统目录对用户界面隐藏。',
  '你（agent）的工作区文件操作照常用常规文件工具；桌面侧的用户操作无需你介入，除非用户在对话中要求协同编辑。',
  '用户提到「工作台 / 桌面 / 文件管理器 / 回收站 / 打开某个文件」等界面操作时即指本插件，可引导用户在侧边栏「工作台」操作。',
  'agent 编辑工作区文件请用 nas_edit 工具（而非普通写文件）：它会生成「变更」记录，用户在桌面「变更」窗口可 diff 并接受/拒绝——这是桌面协同的审阅流；被拒绝时改动会回滚。',
].join('')

/**
 * Resolve the workspace root for one request: the owning session's frozen
 * cwd when the session can be found, else the sandbox workspace root, else
 * the process cwd.
 */
function makeRootResolver(ctx: Context): RootResolver {
  return (sessionId?: string): string => {
    if (sessionId !== undefined) {
      try {
        const sessions = ctx.get('sessions')
        const session = sessions?.get(sessionId as SessionId)
        const cwd = session?.header.cwd
        if (typeof cwd === 'string' && cwd.length > 0) return cwd
      } catch {
        // fall through
      }
    }
    try {
      const policy = ctx.get('sandboxPolicy')
      const workspaceRoot = policy?.workspaceRoot
      if (typeof workspaceRoot === 'string' && workspaceRoot.length > 0) return workspaceRoot
    } catch {
      // fall through
    }
    return process.cwd()
  }
}

/** Plugin config schema (settings surface edits this). */
export const Config = z.object({
  enabled: z.boolean().default(true),
  announceToAgent: z.boolean().default(true),
})

/**
 * Plugin entry. Registers the nas.apps service (software packages register
 * their app metadata), the /api/dsh-nas route family, desktop prefs, and the
 * live master switch (enabled -> prompt section + routes).
 */
export function apply(ctx: Context, config?: Config): void {
  const apps = new AppRegistry()
  const prefsStore: NasConfigFile = readConfig()
  let prefs: NasPrefs = {
    mode: prefsStore.prefs?.mode ?? 'panel',
    open: prefsStore.prefs?.open ?? false,
  }

  const resolveRoot = makeRootResolver(ctx)

  // Per-root M2 runtime: index maintenance, scheduler, notifier. The
  // scheduler is rebuilt when the workspace root changes (session switch).
  const runtimes = new Map<string, { search: SearchIndex; scheduler: TaskScheduler; notifier: Notifier }>()
  let activeRoot: string | undefined
  let activeScheduler: TaskScheduler | undefined

  const runtimeFor = (root: string): { search: SearchIndex; scheduler: TaskScheduler; notifier: Notifier } => {
    let runtime = runtimes.get(root)
    if (runtime === undefined) {
      const db = dbFor(root)
      const notifier = new Notifier(db)
      const scheduler = new TaskScheduler(db, root, async (task) => {
        // Notify action: enqueue + deliver immediately to the task URL.
        if (task.actionTarget === '') return
        const row = notifier.enqueue(`schedule:${task.id}`, 'schedule.fire', `schedule:${task.id}:${Date.now()}`)
        await notifier.deliver(row.id, task.actionTarget, {
          event: 'schedule.fire', task: task.name, cron: task.cron, ts: Date.now(),
        })
      })
      runtime = { search: new SearchIndex(db), scheduler, notifier }
      runtimes.set(root, runtime)
    }
    if (activeRoot !== root) {
      activeScheduler?.stop()
      activeScheduler = runtime.scheduler
      runtime.scheduler.start()
      activeRoot = root
      // Initial rescan keeps the index fresh across restarts — run it
      // asynchronously so the first request is not blocked on indexing.
      setTimeout(() => {
        try { runtime.search.rescan(root) } catch { /* best effort */ }
      }, 0)
    }
    return runtime
  }

  const fs = new FsApi(resolveRoot, (root, rel, op) => {
    try {
      const runtime = runtimeFor(root)
      if (op === 'write' || op === 'copy' || op === 'mkdir') runtime.search.upsert(rel, root)
      else if (op === 'move') {
        // Re-index both the source (now missing -> remove) and the target.
        runtime.search.upsert(rel, root)
        runtime.search.rescan(root)
      } else if (op === 'delete') runtime.search.remove(rel)
    } catch {
      // index maintenance must never break file ops
    }
  })

  // App registry service: software packages call ctx.nas.apps.register(...).
  ctx.provide(NAS_APPS_SERVICE, apps)

  const routeCtx: NasRouteContext = {
    searchFor: (root) => runtimeFor(root).search,
    scheduleFor: (root) => runtimeFor(root).scheduler,
    notifyFor: (root) => runtimeFor(root).notifier,

    fs,
    apps,
    getPrefs: () => prefs,
    setPrefs: (next) => {
      prefs = next
      writeConfig({ ...readConfig(), prefs: { mode: next.mode, open: next.open } })
    },
    getConfig: () => current(),
    updateConfig: async (patch: Record<string, unknown>) => {
      const settings = ctx.get('settings')
      if (settings === undefined) return { ok: false, error: 'settings service unavailable' }
      try {
        await settings.update(NAS_NS, patch)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
  // Management routes (apps.list / settings.get / settings.set) are ALWAYS
  // registered: the panel needs them to show state and to turn the system
  // back on after a disable. Only the filesystem-touching data routes follow
  // the master switch.
  for (const route of managementRoutes(routeCtx)) {
    ctx.webServer.register(route)
  }
  const routes = dataRoutes(routeCtx)

  // Live configuration source: the settings section once the web settings
  // surface is served, the composition entry otherwise.
  let current: () => Config = () => config ?? {}
  let disposeSection: (() => void) | undefined
  let disposeRoutes: (() => void) | undefined

  let disposeTool: (() => void) | undefined

  const sync = (): void => {
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (disposeRoutes !== undefined) { disposeRoutes(); disposeRoutes = undefined }
    if (disposeTool !== undefined) { disposeTool(); disposeTool = undefined }
    const value = current()
    if (!value.enabled) return
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-nas',
        order: SECTION_ORDER,
        text: NAS_GUIDANCE,
      })
    }
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map((route) => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-nas: routes',
    )
    // nas_edit tool: staged agent edits go through the review ledger.
    try {
      const tools = ctx.get('tools') as { register(definition: { name: string; description: string; parameters: Record<string, { type: string; required?: boolean; description?: string; enum?: string[] }>; execute(args: Record<string, unknown>): Promise<unknown> | unknown; output?: { schema?: unknown } }): () => void } | undefined
      if (tools !== undefined) {
        disposeTool = tools.register({
          name: 'nas_edit',
          description: '编辑工作区文件（相对路径）。写入内容并生成审阅「变更」记录——用户在桌面「变更」窗口可查看 diff 并接受或拒绝；拒绝会回滚改动。协同编辑请用此工具而非直接写文件。',
          parameters: {
            path: { type: 'string', required: true, description: '工作区相对路径（如 docs/plan.md），必须在当前会话工作区内。' },
            content: { type: 'string', required: true, description: '文件新内容（UTF-8）。' },
          },
          execute: async (args: Record<string, unknown>) => {
            const path = typeof args.path === 'string' ? args.path : ''
            const content = typeof args.content === 'string' ? args.content : ''
            if (path === '') return { ok: false, error: 'path required' }
            const outcome = fs.write(path, content, undefined, true)
            return { ok: outcome.ok, error: outcome.error, path, reviewId: outcome.reviewId }
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ok: { type: 'boolean', required: true },
                error: { type: 'string' },
                path: { type: 'string' },
                reviewId: { type: 'integer' },
              },
            },
          },
        })
      }
    } catch {
      // tools unavailable -> degrade
    }
  }

  installSettingsSection(ctx, NAS_NS, Config, config ?? {}, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSettingsSection never fires its hooks).
  sync()
}

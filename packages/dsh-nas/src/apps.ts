/**
 * App registry: software packages (dsh-office, dsh-mail, ...) register their
 * application metadata here; the desktop surfaces list apps and route files
 * by extension. Registration is process-local (plugins re-register on every
 * boot) — no persistence needed.
 */

import type { NasAppMeta } from './protocol.ts'

/** Stable cordis service name provided by the dsh-nas host half. */
export const NAS_APPS_SERVICE = 'nas.apps'

/** App registry implementation. */
export class AppRegistry {
  private readonly apps = new Map<string, NasAppMeta>()

  /** Register or replace one app; returns a disposer (unregister). */
  register(app: NasAppMeta): () => void {
    this.apps.set(app.id, app)
    return () => { if (this.apps.get(app.id)?.windowKind === app.windowKind) this.apps.delete(app.id) }
  }

  /** Every registered app, sorted by id. */
  list(): NasAppMeta[] {
    return [...this.apps.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  /** The app able to open `ext` (lowercase, no dot), or undefined. */
  byExtension(ext: string): NasAppMeta | undefined {
    const needle = ext.toLowerCase().replace(/^\./, '')
    for (const app of this.apps.values()) {
      if (app.fileExts.includes(needle)) return app
    }
    return undefined
  }

  get(id: string): NasAppMeta | undefined {
    return this.apps.get(id)
  }
}

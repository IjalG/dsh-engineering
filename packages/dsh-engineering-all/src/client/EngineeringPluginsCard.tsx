/**
 * Engineering family group card — the unified dsh-engineering management
 * panel inside 设置 > 插件 > 插件配置 (registered as a `settings.plugin.item`
 * group card).
 *
 * Members render as expandable entries. All members belong to this family:
 * dsh-beyond-workscope (full provider — the dsh-web-ui copy is deleted),
 * dsh-nas, dsh-office, dsh-mail.
 *
 * Failure policy: fetch problems degrade to a quiet "no data" state — this
 * panel must never take the settings page down.
 */

import { useCallback, useEffect, useState } from 'react'
import type { EngineeringPluginsKey } from './locales.ts'
import css from './EngineeringPluginsCard.module.css'

/** Minimal slots surface the panel reads (structural, matches the runtime service). */
interface SlotsLike {
  entries(name: string): ReadonlyArray<{ options: { id?: string } }>
  subscribe(name: string, fn: () => void): () => void
}

/** Poll cadence for member overview data (ms). */
const POLL_MS = 5000

/** Beyond-workscope wire views (read-only overview, no writes). */
interface WorkspaceView {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly sessionId: string
}

interface AuditEntry {
  readonly id: string
  readonly at: string
  readonly sessionId: string
  readonly kind: string
  readonly detail: string
}

/** Beyond-workscope API prefix (read-only fetches). */
const BEYOND_API = '/api/dsh-beyond-workscope'
/** dsh-nas API prefix. */
const NAS_API = '/api/dsh-nas'

/** One member card's runtime state. */
interface BeyondState {
  /** Whether the beyond-workscope API answers (installed + running). */
  running: boolean
  workspaces: WorkspaceView[]
  audit: AuditEntry[]
}

/** dsh-nas member state: API reachability + master switch. */
interface NasState {
  running: boolean
  enabled: boolean
  busy: boolean
}

/** The engineering group card. */
export function EngineeringPluginsCard(props: {
  slots: SlotsLike
  t: (key: EngineeringPluginsKey) => string
}) {
  const { slots, t } = props
  const [expanded, setExpanded] = useState(false)
  const [beyond, setBeyond] = useState<BeyondState>({ running: false, workspaces: [], audit: [] })
  const [nas, setNas] = useState<NasState>({ running: false, enabled: true, busy: false })

  // Read-only overview of the beyond-workscope member (only while visible).
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [workspaces, audit] = await Promise.all([
        fetch(`${BEYOND_API}/workspaces`).then(r => (r.ok ? r.json() : Promise.reject())),
        fetch(`${BEYOND_API}/audit`).then(r => (r.ok ? r.json() : Promise.reject())),
      ])
      setBeyond({
        running: true,
        workspaces: workspaces.workspaces ?? [],
        audit: (audit.entries ?? []).slice(0, 3),
      })
    } catch {
      setBeyond({ running: false, workspaces: [], audit: [] })
    }
  }, [])

  useEffect(() => {
    if (!expanded) return
    void refresh()
    const timer = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(timer)
  }, [expanded, refresh])

  // dsh-nas member state: API reachability + master switch (polled).
  const refreshNas = useCallback(async (): Promise<void> => {
    try {
      const [apps, settings] = await Promise.all([
        fetch(`${NAS_API}/apps.list`).then(r => (r.ok ? r.json() : Promise.reject())),
        fetch(`${NAS_API}/settings.get`).then(r => (r.ok ? r.json() : Promise.reject())),
      ])
      setNas({ running: true, enabled: settings.config?.enabled !== false, busy: false })
    } catch {
      setNas(prev => ({ running: false, enabled: prev.enabled, busy: false }))
    }
  }, [])

  useEffect(() => {
    if (!expanded) return
    void refreshNas()
    const timer = setInterval(() => { void refreshNas() }, POLL_MS)
    return () => clearInterval(timer)
  }, [expanded, refreshNas])

  // Toggle the dsh-nas master switch through its settings API.
  const toggleNas = async (): Promise<void> => {
    setNas(prev => ({ ...prev, busy: true }))
    try {
      await fetch(`${NAS_API}/settings.set`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch: { enabled: !nas.enabled } }),
      })
    } catch {
      // state refresh below reports reality
    }
    await refreshNas()
  }

  return (
    <div className={css.card}>
      <button type="button" className={css.header} onClick={() => setExpanded(open => !open)}>
        <span className={css.title}>{t('title')}</span>
        <span className={css.expand}>{expanded ? t('collapse') : t('expand')}</span>
      </button>
      <div className={css.description}>{t('description')}</div>
      {expanded && (
        <div className={css.body}>
          <div className={css.member}>
            <div className={css.memberHeader}>
              <span className={css.memberName}>{t('member.beyond.name')}</span>
              <span className={css.status} data-running={beyond.running}>
                {beyond.running ? t('member.status.running') : t('member.status.missing')}
              </span>
            </div>
            <div className={css.memberDesc}>{t('member.beyond.description')}</div>
            <div className={css.meta}>
              <span>{t('member.workspaces')}: {beyond.workspaces.length}</span>
              {beyond.workspaces.slice(0, 3).map(w => (
                <span className={css.metaPath} key={w.id} title={w.path}>{w.title}</span>
              ))}
            </div>
            <div className={css.meta}>
              <span>{t('member.audit')}:</span>
              {beyond.audit.length === 0 && <span>{t('member.noData')}</span>}
              {beyond.audit.map(entry => (
                <span className={css.auditLine} key={entry.id}>
                  {entry.kind} · {entry.detail.slice(0, 40)}
                </span>
              ))}
            </div>
            <div className={css.hint}>{t('member.manage.hint')}</div>
          </div>
          <div className={css.member}>
            <div className={css.memberHeader}>
              <span className={css.memberName}>{t('member.nas.name')}</span>
              <span className={css.status} data-running={nas.running && nas.enabled}>
                {!nas.running
                  ? t('member.status.missing')
                  : nas.enabled ? t('member.nas.status.running') : t('member.nas.status.disabled')}
              </span>
            </div>
            <div className={css.memberDesc}>{t('member.nas.description')}</div>
            <div className={css.meta}>
              <label className={css.switchRow}>
                <input
                  type="checkbox"
                  checked={nas.enabled}
                  disabled={!nas.running || nas.busy}
                  onChange={() => void toggleNas()}
                />
                <span>{nas.busy ? t('member.toggle.updating') : (nas.enabled ? t('member.nas.toggle.disable') : t('member.nas.toggle.enable'))}</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

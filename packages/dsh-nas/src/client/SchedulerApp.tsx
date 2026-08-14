/**
 * Scheduler window: scheduled tasks (cron) with notify/log actions, plus the
 * notification ledger (idempotent webhook deliveries with retry/verdict).
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NasKey } from './locales.ts'
import type { ScheduleTask } from '../scheduler.ts'
import type { NotificationRow } from '../notify.ts'
import type { NasWindow } from './store.ts'
import { NasApi } from './api.ts'
import css from './desktop.module.css'

export interface SchedulerAppProps {
  window: NasWindow
  t: Translate<NasKey>
}

const api = new NasApi()

const STATUS_LABEL: Record<string, string> = {
  pending: 'pending', sending: 'sending', succeeded: 'ok', failed: 'failed', uncertain: '?',
}

export function SchedulerApp({ t }: SchedulerAppProps): React.ReactElement {
  const [tasks, setTasks] = useState<ScheduleTask[]>([])
  const [items, setItems] = useState<NotificationRow[]>([])
  const [name, setName] = useState('')
  const [cron, setCron] = useState('0 9 * * *')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | undefined>()

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [taskResult, notifyResult] = await Promise.all([api.scheduleList(), api.notifyList()])
      if (taskResult.ok) setTasks(taskResult.tasks)
      if (notifyResult.ok) setItems(notifyResult.items)
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const create = async (): Promise<void> => {
    setError(undefined)
    if (name.trim() === '' || cron.trim() === '') { setError(t('scheduler.needNameCron')); return }
    try {
      const result = await api.scheduleCreate(name.trim(), cron.trim(), target.trim() === '' ? 'log' : 'notify', target.trim())
      if (!result.ok && result.error !== undefined) setError(result.error)
      else { setName(''); setTarget(''); void refresh() }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggle = async (task: ScheduleTask): Promise<void> => {
    await api.scheduleToggle(task.id, !task.enabled)
    void refresh()
  }

  const remove = async (task: ScheduleTask): Promise<void> => {
    if (!globalThis.confirm(`${t('scheduler.removeConfirm')} ${task.name}?`)) return
    await api.scheduleRemove(task.id)
    void refresh()
  }

  const fire = async (task: ScheduleTask): Promise<void> => {
    await api.scheduleFire(task.id)
    void refresh()
  }

  const retry = async (id: number): Promise<void> => {
    await api.notifyRetry(id)
    void refresh()
  }

  const resolve = async (id: number, verdict: 'succeeded' | 'failed'): Promise<void> => {
    await api.notifyResolve(id, verdict)
    void refresh()
  }

  return (
    <div className={css.fm}>
      <div className={css.fmToolbar}>
        <span className={css.fmCwd}>{t('app.scheduler')}</span>
        <span className={css.fmSpacer} />
        <button type="button" className={css.fmButton} onClick={() => void refresh()}>{t('fm.refresh')}</button>
      </div>
      {error !== undefined && <div className={css.fmError}>{error}</div>}
      <div className={css.schedCreate}>
        <input className={css.fmSearch} placeholder={t('scheduler.namePlaceholder')} value={name} onChange={(event) => setName(event.target.value)} />
        <input className={css.fmSearch} placeholder="cron" value={cron} onChange={(event) => setCron(event.target.value)} title={t('scheduler.cronHint')} />
        <input className={[css.fmSearch, css.schedTarget].join(' ')} placeholder={t('scheduler.targetPlaceholder')} value={target} onChange={(event) => setTarget(event.target.value)} />
        <button type="button" className={css.fmButton} onClick={() => void create()}>{t('scheduler.add')}</button>
      </div>
      <div className={css.fmList}>
        {tasks.length === 0 && <div className={css.fmEmpty}>{t('scheduler.empty')}</div>}
        {tasks.map((task) => (
          <div key={task.id} className={css.fmRow}>
            <div className={css.fmRowMain}>
              <span className={[css.schedDot, task.enabled ? css.schedDotOn : ''].join(' ')} aria-hidden="true" />
              <span className={css.fmName}>{task.name}</span>
              <span className={css.fmMeta}>{task.cron}</span>
              <span className={css.fmMeta}>{task.actionType}{task.actionTarget !== '' ? ` -> ${task.actionTarget}` : ''}</span>
            </div>
            <div className={css.fmRowActions}>
              <button type="button" className={css.fmMini} title={t('scheduler.fire')} onClick={() => void fire(task)}>F</button>
              <button type="button" className={css.fmMini} title={task.enabled ? t('scheduler.disable') : t('scheduler.enable')} onClick={() => void toggle(task)}>{task.enabled ? 'II' : 'I>'}</button>
              <button type="button" className={[css.fmMini, css.fmMiniDanger].join(' ')} title={t('fm.delete')} onClick={() => void remove(task)}>D</button>
            </div>
          </div>
        ))}
      </div>
      <div className={css.schedNotify}>
        <div className={css.schedNotifyHeader}>{t('scheduler.notifyLedger')}</div>
        {items.length === 0 && <div className={css.fmEmpty}>{t('scheduler.notifyEmpty')}</div>}
        {items.map((item) => (
          <div key={item.id} className={css.fmRow}>
            <div className={css.fmRowMain}>
              <span className={css.fmName}>{item.eventType}</span>
              <span className={[css.schedStatus, `is-${item.status}`].join(' ')}>{STATUS_LABEL[item.status] ?? item.status}</span>
              <span className={css.fmMeta}>{new Date(item.createdAt).toLocaleString()}</span>
              {item.error !== undefined && <span className={css.searchSnippet}>{item.error.slice(0, 60)}</span>}
            </div>
            <div className={css.fmRowActions}>
              {(item.status === 'failed' || item.status === 'uncertain') && (
                <>
                  <button type="button" className={css.fmMini} title={t('scheduler.retry')} onClick={() => void retry(item.id)}>R</button>
                  <button type="button" className={css.fmMini} title={t('scheduler.verdictOk')} onClick={() => void resolve(item.id, 'succeeded')}>OK</button>
                  <button type="button" className={css.fmMini} title={t('scheduler.verdictFail')} onClick={() => void resolve(item.id, 'failed')}>NO</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

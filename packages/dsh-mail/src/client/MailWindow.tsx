/**
 * Mail window: inbox list, message reading, compose/send, settings.
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { MailKey } from './locales.ts'
import type { MailMessage, MailSummary } from '../mail.ts'
import { MailApi, type MailConfigView } from './api.ts'
import css from './mail.module.css'

/** Window shape from the nas desktop (structural). */
interface NasWindowLike {
  id: string
  kind: string
  title: string
  path?: string
}

export interface MailWindowProps {
  window: NasWindowLike
  close: () => void
  t: Translate<MailKey>
}

const api = new MailApi()

type View = 'inbox' | 'compose' | 'settings'

export function MailWindow({ t }: MailWindowProps): React.ReactElement {
  const [view, setView] = useState<View>('inbox')
  const [items, setItems] = useState<MailSummary[]>([])
  const [message, setMessage] = useState<MailMessage | undefined>()
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState('')
  const [config, setConfig] = useState<MailConfigView>({ mock: true, smtpHost: '', smtpPort: 587, imapHost: '', imapPort: 993, fromName: '', fromAddress: '' })

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await api.inboxList()
      setItems(result.items)
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const open = async (item: MailSummary): Promise<void> => {
    const result = await api.messageRead(item.uid)
    if (result.message !== undefined) setMessage(result.message)
  }

  const send = async (): Promise<void> => {
    if (to.trim() === '') return
    setStatus(t('sending'))
    const result = await api.send(to.trim(), subject, body)
    if (!result.ok) { setStatus(result.error ?? ''); return }
    setStatus(t('sent'))
    setTo(''); setSubject(''); setBody('')
    setTimeout(() => setStatus(''), 1500)
  }

  const loadConfig = useCallback(async (): Promise<void> => {
    try {
      const result = await api.configGet()
      if (result.ok) setConfig(result.config)
    } catch {
      // keep defaults
    }
  }, [])

  useEffect(() => { void loadConfig() }, [loadConfig])

  const saveConfig = async (): Promise<void> => {
    await api.configSet({ ...config, mock: config.mock ? 'true' : 'false' })
    setStatus(t('settings.saved'))
    setTimeout(() => setStatus(''), 1500)
  }

  return (
    <div className={css.container}>
      <div className={css.toolbar}>
        <button type="button" className={[css.tab, view === 'inbox' ? css.tabActive : ''].join(' ')} onClick={() => { setView('inbox'); setMessage(undefined) }}>{t('inbox')}</button>
        <button type="button" className={[css.tab, view === 'compose' ? css.tabActive : ''].join(' ')} onClick={() => setView('compose')}>{t('compose')}</button>
        <button type="button" className={[css.tab, view === 'settings' ? css.tabActive : ''].join(' ')} onClick={() => setView('settings')}>{t('settings')}</button>
        <span className={css.spacer} />
        {status !== '' && <span className={css.status}>{status}</span>}
        {view === 'inbox' && <button type="button" className={css.button} onClick={() => void refresh()}>{t('refresh')}</button>}
      </div>

      {view === 'inbox' && (
        <div className={css.body}>
          {message === undefined ? (
            <div className={css.list}>
              {items.length === 0 && <div className={css.empty}>{t('inbox.empty')}</div>}
              {items.map((item) => (
                <button key={`${item.uid}-${item.date}`} type="button" className={css.row} onClick={() => void open(item)}>
                  <span className={[css.dot, item.seen ? '' : css.dotUnseen].join(' ')} aria-hidden="true" />
                  <span className={css.rowSubject}>{item.subject}</span>
                  <span className={css.rowFrom}>{item.from}</span>
                  <span className={css.rowDate}>{new Date(item.date).toLocaleString()}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className={css.reader}>
              <div className={css.readerHead}>
                <span className={css.readerSubject}>{message.subject}</span>
                <span className={css.readerMeta}>{t('from')}: {message.from} · {new Date(message.date).toLocaleString()}</span>
                <div className={css.untrusted}>{t('untrusted')}</div>
              </div>
              <pre className={css.readerBody}>{message.text}</pre>
              <button type="button" className={css.button} onClick={() => setMessage(undefined)}>{t('back')}</button>
            </div>
          )}
        </div>
      )}

      {view === 'compose' && (
        <div className={css.body}>
          <div className={css.form}>
            <div className={css.formRow}>
              <span className={css.label}>{t('to')}</span>
              <input className={css.input} value={to} onChange={(event) => setTo(event.target.value)} placeholder="a@example.com" />
            </div>
            <div className={css.formRow}>
              <span className={css.label}>{t('subject')}</span>
              <input className={css.input} value={subject} onChange={(event) => setSubject(event.target.value)} />
            </div>
            <div className={css.formRow}>
              <span className={css.label}>{t('body')}</span>
              <textarea className={[css.input, css.textarea].join(' ')} value={body} onChange={(event) => setBody(event.target.value)} />
            </div>
            <div className={css.formRow}>
              <button type="button" className={css.button} onClick={() => void send()} disabled={to.trim() === ''}>{t('send')}</button>
            </div>
          </div>
        </div>
      )}

      {view === 'settings' && (
        <div className={css.body}>
          <div className={css.form}>
            <label className={css.checkRow}>
              <input type="checkbox" checked={config.mock} onChange={(event) => setConfig({ ...config, mock: event.target.checked })} />
              {t('settings.mock')}
            </label>
            <div className={css.formRow}><span className={css.label}>{t('settings.smtpHost')}</span><input className={css.input} value={config.smtpHost} onChange={(event) => setConfig({ ...config, smtpHost: event.target.value })} /></div>
            <div className={css.formRow}><span className={css.label}>{t('settings.smtpPort')}</span><input className={css.input} type="number" value={config.smtpPort} onChange={(event) => setConfig({ ...config, smtpPort: Number(event.target.value) || 587 })} /></div>
            <div className={css.formRow}><span className={css.label}>{t('settings.smtpUser')}</span><input className={css.input} value={config.smtpUser ?? ''} onChange={(event) => setConfig({ ...config, smtpUser: event.target.value })} /></div>
            <div className={css.formRow}><span className={css.label}>{t('settings.smtpPass')}</span><input className={css.input} type="password" value={config.smtpPass ?? ''} onChange={(event) => setConfig({ ...config, smtpPass: event.target.value })} /></div>
            <div className={css.formRow}><span className={css.label}>{t('settings.imapHost')}</span><input className={css.input} value={config.imapHost} onChange={(event) => setConfig({ ...config, imapHost: event.target.value })} /></div>
            <div className={css.formRow}><span className={css.label}>{t('settings.imapPort')}</span><input className={css.input} type="number" value={config.imapPort} onChange={(event) => setConfig({ ...config, imapPort: Number(event.target.value) || 993 })} /></div>
            <div className={css.formRow}><span className={css.label}>{t('settings.imapUser')}</span><input className={css.input} value={config.imapUser ?? ''} onChange={(event) => setConfig({ ...config, imapUser: event.target.value })} /></div>
            <div className={css.formRow}><span className={css.label}>{t('settings.imapPass')}</span><input className={css.input} type="password" value={config.imapPass ?? ''} onChange={(event) => setConfig({ ...config, imapPass: event.target.value })} /></div>
            <div className={css.formRow}><span className={css.label}>{t('settings.fromName')}</span><input className={css.input} value={config.fromName} onChange={(event) => setConfig({ ...config, fromName: event.target.value })} /></div>
            <div className={css.formRow}><span className={css.label}>{t('settings.fromAddress')}</span><input className={css.input} value={config.fromAddress} onChange={(event) => setConfig({ ...config, fromAddress: event.target.value })} /></div>
            <div className={css.formRow}>
              <button type="button" className={css.button} onClick={() => void saveConfig()}>{t('settings.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

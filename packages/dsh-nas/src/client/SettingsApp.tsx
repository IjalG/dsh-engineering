/**
 * Settings window: desktop mode (sidebar-embedded / fullscreen), installed
 * software list (from the app registry), and about. Preferences persist to
 * ~/.dsh/dsh-nas.json via prefs.get/prefs.set.
 */

import React, { useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NasKey } from './locales.ts'
import type { NasAppMeta, NasPrefs } from '../protocol.ts'
import type { NasWindow } from './store.ts'
import { NasApi } from './api.ts'
import { desktopStore } from './store.ts'
import css from './desktop.module.css'

export interface SettingsAppProps {
  window: NasWindow
  t: Translate<NasKey>
}

const api = new NasApi()

export function SettingsApp({ t }: SettingsAppProps): React.ReactElement {
  const [prefs, setPrefs] = useState<NasPrefs>({ mode: 'panel', open: true })
  const [apps, setApps] = useState<NasAppMeta[]>([])

  useEffect(() => {
    void api.prefsGet().then((result) => { if (result.ok) setPrefs(result.prefs) }).catch(() => {})
    void api.appsList().then((result) => { if (result.ok) setApps(result.apps) }).catch(() => {})
  }, [])

  const changeMode = (mode: 'panel' | 'fullscreen'): void => {
    const next = { ...prefs, mode }
    setPrefs(next)
    desktopStore.setMode(mode)
    void api.prefsSet(next).catch(() => {})
  }

  return (
    <div className={css.settings}>
      <section className={css.settingsSection}>
        <h3 className={css.settingsHeading}>{t('settings.mode')}</h3>
        <div className={css.settingsRow}>
          <label className={[css.settingsOption, prefs.mode === 'panel' ? css.settingsOptionActive : ''].join(' ')}>
            <input type="radio" name="nas-mode" checked={prefs.mode === 'panel'} onChange={() => changeMode('panel')} />
            {t('settings.mode.panel')}
          </label>
          <label className={[css.settingsOption, prefs.mode === 'fullscreen' ? css.settingsOptionActive : ''].join(' ')}>
            <input type="radio" name="nas-mode" checked={prefs.mode === 'fullscreen'} onChange={() => changeMode('fullscreen')} />
            {t('settings.mode.fullscreen')}
          </label>
        </div>
      </section>
      <section className={css.settingsSection}>
        <h3 className={css.settingsHeading}>{t('settings.apps')}</h3>
        {apps.length === 0 && <div className={css.settingsMuted}>{t('settings.apps.missing')}</div>}
        <ul className={css.settingsApps}>
          {apps.map((app) => (
            <li key={app.id} className={css.settingsApp}>
              <span className={css.settingsAppIcon} dangerouslySetInnerHTML={{ __html: app.icon }} />
              <span className={css.settingsAppName}>{app.name}</span>
              <span className={css.settingsAppPkg}>{app.packageName}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className={css.settingsSection}>
        <h3 className={css.settingsHeading}>{t('settings.about')}</h3>
        <div className={css.settingsMuted}>{t('settings.about.text')}</div>
      </section>
    </div>
  )
}

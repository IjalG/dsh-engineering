/**
 * Sidebar entry button for the NAS desktop (sidebar.footer.action occupant).
 * Separate .tsx file: the client entry (index.ts) must stay plain TS — the
 * shared bundle preset pins the client entry at src/client/index.ts, and TS
 * only parses JSX in .tsx files.
 */

import type { NasKey } from './locales.ts'
import { desktopStore } from './store.ts'

export interface EntryButtonProps {
  t: (key: NasKey) => string
}

/** Toggle the desktop from the sidebar. */
export function EntryButton({ t }: EntryButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      className="dsh-nas-entry"
      title={t('entry.tooltip')}
      aria-label={t('entry.label')}
      onClick={() => desktopStore.toggleDesktop()}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 13, width: '100%' }}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
        <path d="M2 6h12M6 6v7.5" />
      </svg>
      <span>{t('entry.label')}</span>
    </button>
  )
}

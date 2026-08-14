/**
 * Browser API for /api/dsh-mail.
 */

import type { MailMessage, MailSummary } from '../mail.ts'

function sessionId(): string | undefined {
  try {
    return document.querySelector<HTMLElement>('[data-session-id]')?.dataset.sessionId
  } catch {
    return undefined
  }
}

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/dsh-mail/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, sessionId: sessionId() }),
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const parsed = await response.json() as { error?: string }
      if (typeof parsed.error === 'string') message = parsed.error
    } catch {
      // keep status
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export interface MailConfigView {
  mock: boolean
  smtpHost: string
  smtpPort: number
  smtpUser?: string
  smtpPass?: string
  imapHost: string
  imapPort: number
  imapUser?: string
  imapPass?: string
  fromName: string
  fromAddress: string
}

/** Mail API facade. */
export class MailApi {
  inboxList(): Promise<{ ok: boolean; items: MailSummary[]; mock: boolean }> {
    return call('inbox.list')
  }
  messageRead(uid: number): Promise<{ ok: boolean; message?: MailMessage; error?: string }> {
    return call('message.read', { uid: String(uid) })
  }
  send(to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
    return call('send', { to, subject, body })
  }
  configGet(): Promise<{ ok: boolean; config: MailConfigView }> {
    return call('config.get')
  }
  configSet(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    return call('config.set', config)
  }
}

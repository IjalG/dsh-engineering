/**
 * Mail engine: IMAP inbox reading (imapflow) and SMTP sending (nodemailer),
 * with a mock mode — no real credentials needed. Mock send writes .eml files
 * into <workspace>/.nas/mail-out/; mock inbox reads .eml files from
 * <workspace>/.nas/mail-in/ (sorted by mtime). Config persists to
 * ~/.dsh/dsh-mail.json (0600).
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, chmodSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'

/** Mail configuration. */
export interface MailConfig {
  mock?: boolean
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPass?: string
  imapHost?: string
  imapPort?: number
  imapUser?: string
  imapPass?: string
  /** Sender identity used for mock/real send. */
  fromName?: string
  fromAddress?: string
}

/** One inbox message summary. */
export interface MailSummary {
  uid: number
  subject: string
  from: string
  date: number
  seen: boolean
  size: number
}

/** One full message. */
export interface MailMessage extends MailSummary {
  text: string
  html?: string
  attachments: Array<{ filename: string; size: number }>
}

/** Send request. */
export interface SendRequest {
  to: string
  subject: string
  body: string
}

/** Default config path. */
export function mailConfigPath(home = process.env.DSH_HOME ?? process.env.HOME ?? '.'): string {
  return join(home, '.dsh', 'dsh-mail.json')
}

/** Read config (missing/corrupt -> mock defaults). */
export function readMailConfig(path = mailConfigPath()): MailConfig {
  try {
    if (!existsSync(path)) return { mock: true }
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as MailConfig
    if (typeof parsed !== 'object' || parsed === null) return { mock: true }
    return parsed
  } catch {
    return { mock: true }
  }
}

/** Write config with 0600. */
export function writeMailConfig(config: MailConfig, path = mailConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  try {
    const { renameSync } = require('node:fs') as typeof import('node:fs')
    renameSync(tmp, path)
  } catch {
    const { copyFileSync, unlinkSync } = require('node:fs') as typeof import('node:fs')
    copyFileSync(tmp, path)
    unlinkSync(tmp)
  }
}

/** Mock inbox dir inside the workspace. */
function mockInbox(root: string): string {
  return join(root, '.nas', 'mail-in')
}

/** Mock outbox dir inside the workspace. */
function mockOutbox(root: string): string {
  return join(root, '.nas', 'mail-out')
}

/** Parse a mock .eml file into a summary. */
function parseEml(filePath: string): MailSummary | undefined {
  try {
    const content = readFileSync(filePath, 'utf8')
    const subject = /^Subject:\s*(.*)$/im.exec(content)?.[1] ?? basename(filePath)
    const from = /^From:\s*(.*)$/im.exec(content)?.[1] ?? 'mock'
    const stat = statSync(filePath)
    return { uid: -1, subject, from, date: stat.mtimeMs, seen: true, size: stat.size }
  } catch {
    return undefined
  }
}

/** Mail engine. */
export class MailEngine {
  constructor(
    private readonly root: string,
    private readonly config: MailConfig,
  ) {}

  /** List inbox summaries (mock: .eml files; real: IMAP search). */
  async listInbox(limit = 50): Promise<MailSummary[]> {
    if (this.config.mock !== false) {
      const dir = mockInbox(this.root)
      if (!existsSync(dir)) return []
      const files = readdirSync(dir).filter((name) => name.endsWith('.eml')).sort()
      const items: MailSummary[] = []
      for (const file of files.slice(-limit)) {
        const parsed = parseEml(join(dir, file))
        if (parsed !== undefined) items.push(parsed)
      }
      return items.reverse()
    }
    const client = new ImapFlow({
      host: this.config.imapHost ?? '',
      port: this.config.imapPort ?? 993,
      secure: true,
      auth: { user: this.config.imapUser ?? '', pass: this.config.imapPass ?? '' },
      logger: false,
    })
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const messages: MailSummary[] = []
        for await (const message of client.fetch('1:*', { envelope: true, uid: true, flags: true, size: true }, { uid: true })) {
          const envelope = message.envelope ?? { subject: undefined, from: undefined, date: undefined }
          messages.push({
            uid: message.uid,
            subject: envelope.subject ?? '(no subject)',
            from: envelope.from?.[0]?.address ?? 'unknown',
            date: envelope.date?.getTime() ?? Date.now(),
            seen: (message.flags ?? new Set<string>()).has('\\Seen'),
            size: message.size ?? 0,
          })
        }
        return messages.slice(-limit).reverse()
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  /** Read one message (mock: the file by index; real: IMAP by uid). */
  async readMessage(uid: number, limit = 50): Promise<MailMessage | undefined> {
    if (this.config.mock !== false) {
      const dir = mockInbox(this.root)
      if (!existsSync(dir)) return undefined
      const files = readdirSync(dir).filter((name) => name.endsWith('.eml')).sort()
      const file = files[files.length - uid]
      if (file === undefined) return undefined
      const content = readFileSync(join(dir, file), 'utf8')
      const parsed = parseEml(join(dir, file))
      if (parsed === undefined) return undefined
      return { ...parsed, text: content, attachments: [] }
    }
    const client = new ImapFlow({
      host: this.config.imapHost ?? '',
      port: this.config.imapPort ?? 993,
      secure: true,
      auth: { user: this.config.imapUser ?? '', pass: this.config.imapPass ?? '' },
      logger: false,
    })
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const message = await client.fetchOne(`${uid}`, { envelope: true, source: true }, { uid: true })
        if (message === false) return undefined
        const source = message.source?.toString('utf8') ?? ''
        return {
          uid,
          subject: message.envelope?.subject ?? '(no subject)',
          from: message.envelope?.from?.[0]?.address ?? 'unknown',
          date: message.envelope?.date?.getTime() ?? Date.now(),
          seen: true,
          size: source.length,
          text: source,
          attachments: [],
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }
  }

  /** Send a mail (mock: write .eml into the workspace outbox). */
  async send(request: SendRequest): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const from = this.config.fromAddress ?? 'nas@localhost'
    const fromName = this.config.fromName ?? 'NAS'
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2, 10)}@nas.local>`
    if (this.config.mock !== false) {
      const dir = mockOutbox(this.root)
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${Date.now()}-sent.eml`)
      const content = [
        `From: ${fromName} <${from}>`,
        `To: ${request.to}`,
        `Subject: ${request.subject}`,
        `Message-ID: ${messageId}`,
        `Date: ${new Date().toISOString()}`,
        '',
        request.body,
      ].join('\r\n')
      writeFileSync(file, content)
      return { ok: true, messageId }
    }
    try {
      const transport = nodemailer.createTransport({
        host: this.config.smtpHost ?? '',
        port: this.config.smtpPort ?? 587,
        secure: false,
        auth: { user: this.config.smtpUser ?? '', pass: this.config.smtpPass ?? '' },
      })
      await transport.sendMail({
        from: `"${fromName}" <${from}>`,
        to: request.to,
        subject: request.subject,
        text: request.body,
        messageId,
      })
      return { ok: true, messageId }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

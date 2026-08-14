/**
 * dsh-mail unit tests: mock outbox send, mock inbox listing, config round-trip.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MailEngine, readMailConfig, writeMailConfig } from '../src/mail.ts'

let tmp: string
let root: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dsh-mail-'))
  root = join(tmp, 'ws')
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('mock send', () => {
  it('writes a .eml into the workspace outbox', async () => {
    const engine = new MailEngine(root, { mock: true })
    const outcome = await engine.send({ to: 'a@example.com', subject: '测试', body: '正文内容' })
    expect(outcome.ok).toBe(true)
    expect(outcome.messageId).toBeDefined()
    const outbox = join(root, '.nas', 'mail-out')
    const files = require('node:fs').readdirSync(outbox) as string[]
    expect(files.length).toBe(1)
    const content = readFileSync(join(outbox, files[0]!), 'utf8')
    expect(content).toContain('Subject: 测试')
    expect(content).toContain('正文内容')
  })
})

describe('mock inbox', () => {
  it('lists and reads .eml files from the inbox dir', async () => {
    const inbox = join(root, '.nas', 'mail-in')
    mkdirSync(inbox, { recursive: true })
    writeFileSync(join(inbox, 'first.eml'), 'Subject: 你好\nFrom: x@example.com\n\n第一条消息正文')
    writeFileSync(join(inbox, 'second.eml'), 'Subject: Hi\nFrom: y@example.com\n\nSecond message')
    const engine = new MailEngine(root, { mock: true })
    const items = await engine.listInbox(10)
    expect(items.length).toBe(2)
    // Newest first (reverse of sorted names).
    expect(items[0]?.subject).toBe('Hi')
    const message = await engine.readMessage(1)
    expect(message?.subject).toBe('Hi')
    expect(message?.text).toContain('Second message')
  })
})

describe('config', () => {
  it('defaults to mock when missing and round-trips writes', () => {
    const path = join(tmp, 'cfg.json')
    expect(readMailConfig(path).mock).toBe(true)
    writeMailConfig({ mock: false, smtpHost: 'smtp.example.com', smtpUser: 'u' }, path)
    const loaded = readMailConfig(path)
    expect(loaded.mock).toBe(false)
    expect(loaded.smtpHost).toBe('smtp.example.com')
  })

  it('tolerates corrupt files', () => {
    const path = join(tmp, 'cfg.json')
    writeFileSync(path, '{broken')
    expect(readMailConfig(path).mock).toBe(true)
  })
})

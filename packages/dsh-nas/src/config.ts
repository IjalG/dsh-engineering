/**
 * dsh-nas configuration: a single private JSON file under the DSH home
 * (~/.dsh/dsh-nas.json, mode 0600). Holds desktop prefs; software packages
 * (dsh-office/dsh-mail) keep their own ~/.dsh/dsh-<pkg>.json files with the
 * same discipline — credentials never go into the workspace or memory.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Default config file location (override in tests). */
export function configPath(home = process.env.DSH_HOME ?? process.env.HOME ?? '.'): string {
  return join(home, '.dsh', 'dsh-nas.json')
}

/** Shape of the persisted config. */
export interface NasConfigFile {
  /** Desktop prefs (last layout mode etc.). */
  prefs?: {
    mode?: 'panel' | 'fullscreen'
    open?: boolean
  }
  /** Feature switches (search/scheduler arrive in later milestones). */
  features?: Record<string, boolean>
}

/** Read the config file (missing/corrupt -> defaults). Never throws. */
export function readConfig(path = configPath()): NasConfigFile {
  try {
    if (!existsSync(path)) return {}
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as NasConfigFile
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed
  } catch {
    return {}
  }
}

/** Atomically write the config file with 0600 permissions. */
export function writeConfig(config: NasConfigFile, path = configPath()): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  // Rename is atomic on POSIX; keeps readers from seeing partial JSON.
  renameSyncSafe(tmp, path)
}

function renameSyncSafe(from: string, to: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { renameSync } = require('node:fs') as typeof import('node:fs')
    renameSync(from, to)
  } catch {
    // Cross-device fallback: copy then unlink.
    const { copyFileSync, unlinkSync } = require('node:fs') as typeof import('node:fs')
    copyFileSync(from, to)
    unlinkSync(from)
  }
}

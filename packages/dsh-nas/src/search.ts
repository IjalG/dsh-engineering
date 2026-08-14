/**
 * Full-text search over workspace files: FTS5 with CJK bigram tokenization.
 * Text files (.txt/.md/.json/.yaml/.yml/.csv/.log/.js/.ts/.tsx/.css/.html/
 * .xml/.ini/.conf) are indexed by content; every file by name. The index
 * lives in .nas/nas.db and is maintained by the filesystem hooks (write /
 * move / copy / delete) plus a full rescan on boot.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import type { NasDb } from './db.ts'

/** Extensions whose content is indexed as text. */
const TEXT_EXTS = new Set(['txt', 'md', 'json', 'yaml', 'yml', 'csv', 'log', 'js', 'ts', 'tsx', 'css', 'html', 'xml', 'ini', 'conf', 'py', 'sh', 'toml', 'sql', 'gitignore', 'env'])
/** Per-file content cap (bytes) — larger files are indexed by name only. */
const MAX_INDEX_BYTES = 2 * 1024 * 1024
/** Directories skipped during rescan (dependency trees etc.). */
const SKIP_DIRS = new Set(['node_modules', '.git', '.pnpm-store', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', '.cache', 'lib'])
/** Rescan file cap (protects the first request on huge workspaces). */
const MAX_RESCAN_FILES = 20000

/** CJK 2-gram tokenizer: "合同管理" -> "合同 同管 管理". */
export function bigramize(input: string): string {
  const tokens: string[] = []
  // Segments: runs of CJK characters vs everything else.
  const cjk = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g
  let last = 0
  let match: RegExpExecArray | null
  let segment = ''
  const flush = (): void => {
    if (segment === '') return
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(segment)) {
      // CJK run -> bigrams
      for (let i = 0; i < segment.length - 1; i++) tokens.push(segment.slice(i, i + 2))
      if (segment.length === 1) tokens.push(segment)
    } else {
      tokens.push(segment)
    }
    segment = ''
  }
  cjk.lastIndex = 0
  while ((match = cjk.exec(input)) !== null) {
    if (match.index > last) { segment += input.slice(last, match.index); flush() }
    segment += match[0]
    last = match.index + 1
  }
  if (last < input.length) { segment += input.slice(last); flush() }
  else flush()
  return tokens.join(' ')
}

/** Build the FTS5 MATCH expression for one user query. */
export function matchExpression(query: string): string {
  const grams = bigramize(query.trim().toLowerCase()).split(/\s+/).filter(Boolean)
  if (grams.length === 0) return ''
  // Every gram must be present (AND); each quoted to avoid FTS syntax breakage.
  return grams.map((gram) => `"${gram.replace(/"/g, '')}"`).join(' AND ')
}

/** One search hit. */
export interface SearchHit {
  path: string
  name: string
  snippet: string
  size: number
  mtime: number
}

/** Whether the file content should be indexed. */
export function isIndexableText(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  const ext = name.slice(dot + 1).toLowerCase()
  return TEXT_EXTS.has(ext)
}

/**
 * Extract indexable text for one file (name + content when text and small).
 */
export function extractIndexText(filePath: string, name: string): string {
  const parts = [name]
  if (isIndexableText(name)) {
    try {
      const stat = statSync(filePath)
      if (stat.size <= MAX_INDEX_BYTES) {
        parts.push(readFileSync(filePath, 'utf8').toLowerCase())
      }
    } catch {
      // unreadable -> name only
    }
  }
  return bigramize(parts.join('\n'))
}

/** Full-text index facade over one workspace root. */
export class SearchIndex {
  constructor(private readonly db: NasDb) {}

  /** Index or re-index one workspace-relative file. */
  upsert(rel: string, root: string): void {
    const filePath = join(root, rel)
    if (!existsSync(filePath)) return
    try {
      const stat = statSync(filePath)
      if (!stat.isFile()) return
      const name = basename(rel)
      const text = extractIndexText(filePath, name)
      this.db.raw.prepare(`
        INSERT INTO nas_files (path, name, ext, size, mtime) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET name = excluded.name, ext = excluded.ext,
          size = excluded.size, mtime = excluded.mtime
      `).run(rel, name, name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '', stat.size, Math.trunc(stat.mtimeMs))
      // FTS5 has no unique constraint: delete + insert to replace.
      this.db.raw.prepare('DELETE FROM nas_fts WHERE path = ?').run(rel)
      this.db.raw.prepare('INSERT INTO nas_fts (path, content) VALUES (?, ?)').run(rel, text)
    } catch {
      // best effort
    }
  }

  /** Remove one file from the index. */
  remove(rel: string): void {
    this.db.raw.prepare('DELETE FROM nas_files WHERE path = ?').run(rel)
    this.db.raw.prepare('DELETE FROM nas_fts WHERE path = ?').run(rel)
  }

  /** Full rescan of the workspace (skips .nas and dependency trees, capped). */
  rescan(root: string): void {
    const stack = ['']
    let indexed = 0
    this.db.raw.exec('BEGIN')
    try {
      while (stack.length > 0 && indexed < MAX_RESCAN_FILES) {
        const dir = stack.pop() ?? ''
        const dirPath = join(root, dir)
        let names: string[]
        try {
          names = readdirSync(dirPath)
        } catch {
          continue
        }
        for (const name of names) {
          if (indexed >= MAX_RESCAN_FILES) break
          if (name === '.nas' || SKIP_DIRS.has(name)) continue
          const rel = dir === '' ? name : `${dir}/${name}`
          const filePath = join(root, rel)
          try {
            const stat = statSync(filePath)
            if (stat.isDirectory()) stack.push(rel)
            else { this.upsert(rel, root); indexed++ }
          } catch {
            // skip
          }
        }
      }
      this.db.raw.exec('COMMIT')
    } catch {
      this.db.raw.exec('ROLLBACK')
    }
  }

  /** Query the index; returns hits sorted by name. */
  query(query: string, limit = 50): SearchHit[] {
    const expr = matchExpression(query)
    if (expr === '') return []
    let rows: Array<{ path: string; content: string }>
    try {
      rows = this.db.raw.prepare(
        `SELECT path, snippet(nas_fts, 1, '[', ']', '…', 24) AS content
         FROM nas_fts WHERE nas_fts MATCH ? ORDER BY rank LIMIT ?`,
      ).all(expr, limit) as Array<{ path: string; content: string }>
    } catch {
      return []
    }
    const hits: SearchHit[] = []
    for (const row of rows) {
      const file = this.db.raw.prepare('SELECT name, size, mtime FROM nas_files WHERE path = ?').get(row.path) as
        { name: string; size: number; mtime: number } | undefined
      if (file === undefined) continue
      hits.push({
        path: row.path,
        name: file.name,
        snippet: row.content,
        size: file.size,
        mtime: file.mtime,
      })
    }
    return hits
  }
}

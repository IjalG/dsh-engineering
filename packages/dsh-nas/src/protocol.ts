/**
 * dsh-nas wire contract: lossless-JSON types shared by the host half
 * (routes) and the browser half (client/api). No live objects cross the
 * boundary — only these plain records.
 */

/** Application metadata registered by software packages (dsh-office, dsh-mail...). */
export interface NasAppMeta {
  /** Stable app id, e.g. "office". */
  id: string
  /** Display name (locale key or plain label). */
  name: string
  /** Icon: inline SVG string (16px stroke style) or emoji-free glyph. */
  icon: string
  /** File extensions this app can open (lowercase, no dot), e.g. ["docx"]. */
  fileExts: string[]
  /** Window kind id used by the client `nas.app.window` keyed slot. */
  windowKind: string
  /** Package name that provides the app (shown when missing). */
  packageName: string
  /** Short description. */
  description?: string
}

/** One directory entry in the file manager. */
export interface NasFsEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  size: number
  mtime: number
  ext: string
}

/** File manager listing result. */
export interface NasFsListResult {
  root: string
  entries: NasFsEntry[]
  error?: string
}

/** Generic action result. */
export interface NasActionResult {
  ok: boolean
  error?: string
}

/** Text read result (bounded). */
export interface NasReadResult {
  ok: boolean
  content?: string
  truncated?: boolean
  size?: number
  error?: string
}

/** Trash entry. */
export interface NasTrashEntry {
  /** Unique trash item id. */
  id: string
  /** Original absolute path (what restore would recreate). */
  originalPath: string
  /** File name shown in trash. */
  name: string
  size: number
  /** Unix ms when deleted. */
  deletedAt: number
  kind: 'file' | 'dir'
}

/** Desktop persistence: window layout + icon positions + settings. */
export interface NasPrefs {
  /** Desktop layout mode the user last chose: "panel" (sidebar-embedded) or "fullscreen". */
  mode: 'panel' | 'fullscreen'
  /** Whether the desktop is currently open. */
  open: boolean
  /** Search-as-you-type query kept across reopens. */
  lastQuery?: string
}

/** Payloads for the /api/dsh-nas route family (all JSON bodies). */
export interface NasFsListPayload {
  path?: string
  sessionId?: string
}
export interface NasFsReadPayload {
  path: string
  sessionId?: string
  maxBytes?: number
}
export interface NasFsWritePayload {
  path: string
  content: string
  sessionId?: string
}
export interface NasFsMkdirPayload {
  path: string
  sessionId?: string
}
export interface NasFsMovePayload {
  src: string
  dest: string
  sessionId?: string
}
export interface NasFsCopyPayload {
  src: string
  dest: string
  sessionId?: string
}
export interface NasFsDeletePayload {
  path: string
  sessionId?: string
}
export interface NasTrashRestorePayload {
  id: string
  sessionId?: string
}
export interface NasTrashEmptyPayload {
  sessionId?: string
}
export interface NasAppsListPayload {
  sessionId?: string
}
export interface NasPrefsSetPayload {
  prefs: NasPrefs
}

/** Route path prefix (matches webServer exact-path convention). */
export const NAS_API_PREFIX = '/api/dsh-nas'

/** Hidden system directory name inside the workspace root. */
export const NAS_SYS_DIR = '.nas'

/** Extensions treated as binary (no text preview/read). */
const BINARY_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'docx', 'xlsx', 'pptx', 'zip', 'gz', 'tar', '7z', 'mp4', 'mp3', 'wav', 'woff', 'woff2', 'ttf', 'otf', 'eot'])

/** Whether a text read makes sense for this extension (pure, browser-safe). */
export function isTextExt(ext: string): boolean {
  return !BINARY_EXTS.has(ext.toLowerCase())
}

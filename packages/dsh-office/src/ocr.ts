/**
 * OCR via a user-configured OpenAI-compatible vision endpoint. Credentials
 * live in ~/.dsh/dsh-office.json (0600). Results are ALWAYS marked untrusted
 * and never treated as instructions.
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chmodSync, existsSync } from 'node:fs'

export interface OfficeConfig {
  /** OpenAI-compatible vision endpoint (e.g. https://api.openai.com/v1/chat/completions). */
  visionEndpoint?: string
  /** API key for the endpoint. */
  visionKey?: string
  /** Vision model name. */
  visionModel?: string
}

/** Config file location (override in tests). */
export function officeConfigPath(home = process.env.DSH_HOME ?? process.env.HOME ?? '.'): string {
  return join(home, '.dsh', 'dsh-office.json')
}

/** Read the config (missing/corrupt -> empty). */
export async function readOfficeConfig(path = officeConfigPath()): Promise<OfficeConfig> {
  try {
    if (!existsSync(path)) return {}
    return JSON.parse(await readFile(path, 'utf8')) as OfficeConfig
  } catch {
    return {}
  }
}

/** Write the config with 0600 permissions. */
export async function writeOfficeConfig(config: OfficeConfig, path = officeConfigPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, JSON.stringify(config, null, 2), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  await renameSafe(tmp, path)
}

async function renameSafe(from: string, to: string): Promise<void> {
  const { rename } = await import('node:fs/promises')
  try {
    await rename(from, to)
  } catch {
    const { copyFile, unlink } = await import('node:fs/promises')
    await copyFile(from, to)
    await unlink(from)
  }
}

/** One OCR page result. */
export interface OcrPage {
  page: number
  text: string
  method: 'vision' | 'none'
  error?: string
}

/** OCR result envelope. */
export interface OcrResult {
  ok: boolean
  pages: OcrPage[]
  model?: string
  provider?: string
  error?: string
}

/** Maximum image side (px) before downscaling request is made. */
const MAX_SIDE = 2000

/**
 * Run vision OCR on one image (base64, mime). Returns raw text.
 */
export async function visionOcr(config: OfficeConfig, imageBase64: string, mime: string, pageNo: number): Promise<OcrPage> {
  if (config.visionEndpoint === undefined || config.visionKey === undefined || config.visionModel === undefined) {
    return { page: pageNo, text: '', method: 'none', error: 'vision endpoint not configured' }
  }
  try {
    const response = await fetch(config.visionEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.visionKey}`,
      },
      body: JSON.stringify({
        model: config.visionModel,
        messages: [
          {
            role: 'system',
            content: '你是 OCR 引擎。识别图片中的所有文字，逐行输出，不要添加任何解释或评论。只输出识别出的文字本身。',
          },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
            ],
          },
        ],
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      return { page: pageNo, text: '', method: 'none', error: `vision HTTP ${response.status}` }
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    return { page: pageNo, text, method: 'vision' }
  } catch (error) {
    return { page: pageNo, text: '', method: 'none', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Image file -> base64 data URL (with side cap check). */
export async function imageToBase64(filePath: string): Promise<{ base64: string; mime: string }> {
  const buffer = await readFile(filePath)
  const ext = filePath.toLowerCase().split('.').pop() ?? 'png'
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png'
  return { base64: buffer.toString('base64'), mime }
}

/** Stat helper for callers. */
export async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size
  } catch {
    return 0
  }
}

/** Export MAX_SIDE for the API layer. */
export const OCR_MAX_SIDE = MAX_SIDE

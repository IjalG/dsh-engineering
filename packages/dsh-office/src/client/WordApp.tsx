/**
 * Word app: TipTap rich-text editor bound to a .docx file. Open converts the
 * docx to HTML (host mammoth); save converts HTML back to docx (host docx).
 */

import React, { useCallback, useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeKey } from './locales.ts'
import { OfficeApi } from './api.ts'
import css from './office.module.css'

export interface WordAppProps {
  path: string
  t: Translate<OfficeKey>
}

const api = new OfficeApi()

export function WordApp({ path, t }: WordAppProps): React.ReactElement {
  const [status, setStatus] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p></p>',
    editorProps: {
      attributes: {
        class: css.editorArea,
        'data-office-editor': 'true',
      },
    },
  })

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await api.wordOpen(path)
      if (!result.ok) { setError(result.error); return }
      editor?.commands.setContent(result.html)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [path, editor])

  useEffect(() => { void load() }, [load])

  const save = async (): Promise<void> => {
    if (editor === null) return
    setStatus(t('editor.saving'))
    try {
      const result = await api.wordSave(path, editor.getHTML())
      if (!result.ok) { setError(result.error); setStatus('') }
      else { setStatus(t('editor.saved')); setTimeout(() => setStatus(''), 1500) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('')
    }
  }

  return (
    <div className={css.container}>
      <div className={css.toolbar}>
        <span className={css.path}>{path}</span>
        <span className={css.spacer} />
        {status !== '' && <span className={css.status}>{status}</span>}
        <button type="button" className={css.button} onClick={() => void save()} disabled={editor === null}>
          {t('editor.save')}
        </button>
        <button type="button" className={css.button} onClick={() => void load()} disabled={editor === null}>
          {t('common.ok')}
        </button>
      </div>
      {error !== undefined && <div className={css.error}>{error}</div>}
      {loading && <div className={css.hint}>{t('editor.saving')}</div>}
      {!loading && editor !== null && <EditorContent editor={editor} className={css.editor} />}
    </div>
  )
}

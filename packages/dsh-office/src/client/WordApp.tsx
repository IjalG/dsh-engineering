/**
 * Word app: TipTap rich-text editor bound to a .docx file with a formatting
 * toolbar (headings, bold/italic/underline/strike, lists, quote, rule,
 * undo/redo). Open converts docx to HTML (host mammoth); save converts HTML
 * back to docx (host docx).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Image from '@tiptap/extension-image'

/** Image extension carrying data-width/height for docx export. */
const ImageWithSize = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-width': {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-width'),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-width': attributes['data-width'],
        }),
      },
      'data-height': {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-height'),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-height': attributes['data-height'],
        }),
      },
    }
  },
})
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeKey } from './locales.ts'
import { OfficeApi } from './api.ts'
import css from './office.module.css'

export interface WordAppProps {
  path: string
  t: Translate<OfficeKey>
}

const api = new OfficeApi()

/** One toolbar button. */
function ToolButton({ label, title, active, disabled, onClick }: {
  label: string; title: string; active?: boolean; disabled?: boolean; onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      className={[css.toolButton, active === true ? css.toolButtonActive : ''].join(' ')}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function WordApp({ path, t }: WordAppProps): React.ReactElement {
  const [currentPath, setCurrentPath] = useState(path)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [wordCount, setWordCount] = useState(0)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      ImageWithSize.configure({ allowBase64: true }),
    ],
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
      const result = await api.wordOpen(currentPath)
      if (!result.ok) { setError(result.error); return }
      editor?.commands.setContent(result.html)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [currentPath, editor])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (editor === null) return
    const onUpdate = (): void => updateWordCount()
    editor.on('update', onUpdate)
    updateWordCount()
    return () => { editor.off('update', onUpdate) }
  }, [editor])

  const save = async (): Promise<void> => {
    if (editor === null) return
    setStatus(t('editor.saving'))
    try {
      const result = await api.wordSave(currentPath, editor.getHTML())
      if (!result.ok) { setError(result.error); setStatus('') }
      else { setStatus(t('editor.saved')); setTimeout(() => setStatus(''), 1500) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('')
    }
  }

  const insertImage = (): void => {
    fileInputRef.current?.click()
  }

  const onImageChosen = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    if (file === undefined || editor === null) return
    if (file.size > 2 * 1024 * 1024) { setError('图片不能超过 2MB'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : ''
      if (src === '') return
      // Probe natural size and stamp it onto the element for docx export.
      const img = new globalThis.Image()
      img.onload = () => {
        const width = Math.round(img.width)
        const height = Math.round(img.height)
        editor.chain().focus().setImage({ src, 'data-width': String(width), 'data-height': String(height) } as never).run()
      }
      img.src = src
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const updateWordCount = (): void => {
    if (editor === null) return
    const text = editor.getText()
    const han = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length
    const words = (text.match(/[a-zA-Z0-9]+/g) ?? []).length
    setWordCount(han + words)
  }

  const findNext = (): void => {
    if (editor === null || findText === '') return
    // Find across the document from the current selection.
    const text = editor.getText()
    const from = editor.state.selection.to
    const haystack = text
    const idx = haystack.toLowerCase().indexOf(findText.toLowerCase(), Math.min(from, haystack.length))
    const realIdx = idx >= 0 ? idx : haystack.toLowerCase().indexOf(findText.toLowerCase())
    if (realIdx < 0) { setStatus('未找到'); return }
    const head = editor.state.doc.resolve(Math.min(realIdx, editor.state.doc.content.size))
    editor.chain().focus().setTextSelection({ from: head.pos, to: Math.min(head.pos + findText.length, editor.state.doc.content.size) }).scrollIntoView().run()
  }

  const replaceOne = (): void => {
    if (editor === null || findText === '') return
    const selected = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)
    if (selected.toLowerCase() === findText.toLowerCase()) {
      editor.chain().focus().insertContent(replaceText).run()
    }
    findNext()
  }

  const replaceAll = (): void => {
    if (editor === null || findText === '') return
    // TipTap has no built-in replace-all; walk matches from the start.
    const text = editor.getText()
    let replaced = 0
    let idx = text.toLowerCase().indexOf(findText.toLowerCase())
    const maxIter = 2000
    while (idx >= 0 && replaced < maxIter) {
      const from = editor.state.doc.resolve(idx)
      editor.chain().focus().setTextSelection({ from: from.pos, to: from.pos + findText.length }).insertContent(replaceText).run()
      replaced++
      const next = editor.getText()
      idx = next.toLowerCase().indexOf(findText.toLowerCase(), idx + replaceText.length)
    }
    setStatus(replaced > 0 ? `已替换 ${replaced} 处` : '未找到')
    setTimeout(() => setStatus(''), 1800)
  }

  const saveAs = async (): Promise<void> => {
    const name = globalThis.prompt('另存为（工作区相对路径）', currentPath)
    if (name === null || name.trim() === '') return
    const target = name.trim().endsWith('.docx') ? name.trim() : `${name.trim()}.docx`
    setStatus(t('editor.saving'))
    try {
      const result = await api.wordSave(target, editor?.getHTML() ?? '')
      if (!result.ok) { setError(result.error); setStatus('') }
      else { setCurrentPath(target); setStatus(t('editor.saved')); setTimeout(() => setStatus(''), 1500) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('')
    }
  }

  const disabled = editor === null

  return (
    <div className={css.container}>
      <div className={css.toolbar}>
        <span className={css.path}>{path}</span>
        <span className={css.spacer} />
        {status !== '' && <span className={css.status}>{status}</span>}
        <button type="button" className={css.button} onClick={() => void save()} disabled={disabled}>
          {t('editor.save')}
        </button>
        <button type="button" className={css.button} onClick={saveAs} disabled={disabled}>
          {t('editor.saveAs')}
        </button>
        <button type="button" className={css.toolButton} title={t('word.findReplace')} onClick={() => setFindOpen((open) => !open)} disabled={disabled}>
          {t('word.find')}
        </button>
        <span className={css.wordCount}>{t('word.count')}: {wordCount}</span>
      </div>
      <div className={css.formatBar}>
        <ToolButton label={t('word.h1')} title={t('word.h1')} active={editor?.isActive('heading', { level: 1 })} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
        <ToolButton label={t('word.h2')} title={t('word.h2')} active={editor?.isActive('heading', { level: 2 })} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolButton label={t('word.h3')} title={t('word.h3')} active={editor?.isActive('heading', { level: 3 })} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
        <span className={css.barSeparator} />
        <ToolButton label={t('word.bold')} title={t('word.bold')} active={editor?.isActive('bold')} disabled={disabled} onClick={() => editor?.chain().focus().toggleBold().run()} />
        <ToolButton label={t('word.italic')} title={t('word.italic')} active={editor?.isActive('italic')} disabled={disabled} onClick={() => editor?.chain().focus().toggleItalic().run()} />
        <ToolButton label={t('word.underline')} title={t('word.underline')} active={editor?.isActive('underline')} disabled={disabled} onClick={() => editor?.chain().focus().toggleUnderline().run()} />
        <ToolButton label={t('word.strike')} title={t('word.strike')} active={editor?.isActive('strike')} disabled={disabled} onClick={() => editor?.chain().focus().toggleStrike().run()} />
        <span className={css.barSeparator} />
        <ToolButton label={t('word.bullet')} title={t('word.bullet')} active={editor?.isActive('bulletList')} disabled={disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
        <ToolButton label={t('word.ordered')} title={t('word.ordered')} active={editor?.isActive('orderedList')} disabled={disabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
        <ToolButton label={t('word.quote')} title={t('word.quote')} active={editor?.isActive('blockquote')} disabled={disabled} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
        <ToolButton label={t('word.rule')} title={t('word.rule')} disabled={disabled} onClick={() => editor?.chain().focus().setHorizontalRule().run()} />
        <span className={css.barSeparator} />
        <ToolButton label={t('word.table')} title={t('word.table')} disabled={disabled} onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
        <ToolButton label={t('word.addRow')} title={t('word.addRow')} disabled={disabled} onClick={() => editor?.chain().focus().addRowAfter().run()} />
        <ToolButton label={t('word.delRow')} title={t('word.delRow')} disabled={disabled} onClick={() => editor?.chain().focus().deleteRow().run()} />
        <ToolButton label={t('word.addCol')} title={t('word.addCol')} disabled={disabled} onClick={() => editor?.chain().focus().addColumnAfter().run()} />
        <ToolButton label={t('word.delCol')} title={t('word.delCol')} disabled={disabled} onClick={() => editor?.chain().focus().deleteColumn().run()} />
        <ToolButton label={t('word.merge')} title={t('word.merge')} disabled={disabled} onClick={() => editor?.chain().focus().mergeCells().run()} />
        <ToolButton label={t('word.headerRow')} title={t('word.headerRow')} active={editor?.isActive('tableHeader')} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeaderRow().run()} />
        <ToolButton label={t('word.delTable')} title={t('word.delTable')} disabled={disabled} onClick={() => editor?.chain().focus().deleteTable().run()} />
        <ToolButton label={t('word.image')} title={t('word.image')} disabled={disabled} onClick={insertImage} />
        <span className={css.barSeparator} />
        <ToolButton label={t('word.undo')} title={t('word.undo')} disabled={disabled || !editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()} />
        <ToolButton label={t('word.redo')} title={t('word.redo')} disabled={disabled || !editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()} />
      </div>
      {findOpen && (
        <div className={css.findBar}>
          <input className={css.findInput} placeholder={t('word.findPlaceholder')} value={findText} onChange={(event) => setFindText(event.target.value)} />
          <input className={css.findInput} placeholder={t('word.replacePlaceholder')} value={replaceText} onChange={(event) => setReplaceText(event.target.value)} />
          <button type="button" className={css.button} onClick={findNext}>{t('word.findNext')}</button>
          <button type="button" className={css.button} onClick={replaceOne}>{t('word.replaceOne')}</button>
          <button type="button" className={css.button} onClick={replaceAll}>{t('word.replaceAll')}</button>
          <button type="button" className={css.button} onClick={() => setFindOpen(false)}>×</button>
        </div>
      )}
      {error !== undefined && <div className={css.error}>{error}</div>}
      {loading && <div className={css.hint}>{t('editor.saving')}</div>}
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onImageChosen} />
      {!loading && editor !== null && <EditorContent editor={editor} className={css.editor} />}
    </div>
  )
}

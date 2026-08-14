/**
 * PPT app: text-slide editor (title + body per slide) bound to .pptx files.
 * Open extracts slide texts; save regenerates the pptx via pptxgenjs.
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeKey } from './locales.ts'
import type { SlideText } from '../docs.ts'
import { OfficeApi } from './api.ts'
import css from './office.module.css'

export interface PptAppProps {
  path: string
  t: Translate<OfficeKey>
}

const api = new OfficeApi()

export function PptApp({ path, t }: PptAppProps): React.ReactElement {
  const [slides, setSlides] = useState<SlideText[]>([{ title: '', body: [] }])
  const [active, setActive] = useState(0)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await api.pptOpen(path)
      if (!result.ok) { setError(result.error); return }
      if (result.slides.length === 0) result.slides.push({ title: '', body: [] })
      setSlides(result.slides)
      setActive(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => { void load() }, [load])

  const updateSlide = (index: number, patch: Partial<SlideText>): void => {
    setSlides((prev) => prev.map((slide, i) => (i === index ? { ...slide, ...patch } : slide)))
  }

  const addSlide = (): void => {
    setSlides((prev) => [...prev, { title: '', body: [] }])
    setActive(slides.length)
  }

  const removeSlide = (index: number): void => {
    if (slides.length <= 1) return
    setSlides((prev) => prev.filter((_, i) => i !== index))
    setActive((prev) => Math.max(0, prev - 1))
  }

  const save = async (): Promise<void> => {
    setStatus(t('editor.saving'))
    try {
      const result = await api.pptSave(path, slides)
      if (!result.ok) { setError(result.error); setStatus('') }
      else { setStatus(t('editor.saved')); setTimeout(() => setStatus(''), 1500) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('')
    }
  }

  const slide = slides[active]

  return (
    <div className={css.container}>
      <div className={css.toolbar}>
        <span className={css.path}>{path}</span>
        <span className={css.spacer} />
        {status !== '' && <span className={css.status}>{status}</span>}
        <button type="button" className={css.button} onClick={addSlide}>{t('ppt.addSlide')}</button>
        <button type="button" className={css.button} onClick={() => void save()}>{t('editor.save')}</button>
      </div>
      {error !== undefined && <div className={css.error}>{error}</div>}
      {loading && <div className={css.hint}>{t('editor.saving')}</div>}
      {!loading && slide !== undefined && (
        <div className={css.pptBody}>
          <div className={css.pptRail}>
            {slides.map((item, index) => (
              <div key={index} className={[css.pptThumb, index === active ? css.pptThumbActive : ''].join(' ')}>
                <button type="button" className={css.pptThumbMain} onClick={() => setActive(index)}>
                  <span className={css.pptThumbTitle}>{item.title !== '' ? item.title : `${t('ppt.slide')} ${index + 1}`}</span>
                  <span className={css.pptThumbBody}>{(item.body[0] ?? '').slice(0, 30)}</span>
                </button>
                <button type="button" className={css.pptThumbDel} onClick={() => removeSlide(index)} aria-label={t('ppt.removeSlide')}>×</button>
              </div>
            ))}
          </div>
          <div className={css.pptEditor}>
            <input
              className={[css.input, css.pptTitleInput].join(' ')}
              placeholder={t('ppt.titlePlaceholder')}
              value={slide.title}
              onChange={(event) => updateSlide(active, { title: event.target.value })}
            />
            <textarea
              className={[css.input, css.pptBodyInput].join(' ')}
              placeholder={t('ppt.bodyPlaceholder')}
              value={slide.body.join('\n')}
              onChange={(event) => updateSlide(active, { body: event.target.value.split('\n') })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

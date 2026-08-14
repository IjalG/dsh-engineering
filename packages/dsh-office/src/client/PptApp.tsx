/**
 * PPT app: text-slide editor (title + body per slide) bound to .pptx files.
 * Open extracts slide texts; save regenerates the pptx via pptxgenjs.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeKey } from './locales.ts'
import type { SlideText } from '../docs.ts'

/** Slide with optional image (base64) and speaker notes. */
interface SlideFull extends SlideText {
  image?: string
  imageMime?: string
  notes?: string
}
import { OfficeApi } from './api.ts'
import css from './office.module.css'

export interface PptAppProps {
  path: string
  t: Translate<OfficeKey>
}

const api = new OfficeApi()

export function PptApp({ path, t }: PptAppProps): React.ReactElement {
  const [slides, setSlides] = useState<SlideFull[]>([{ title: '', body: [] }])
  const [show, setShow] = useState(false)
  const [showIndex, setShowIndex] = useState(0)
  const [theme, setTheme] = useState('blue')
  const [layout, setLayout] = useState<'title' | 'content' | 'section'>('content')
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  const updateSlide = (index: number, patch: Partial<SlideFull>): void => {
    setSlides((prev) => prev.map((slide, i) => (i === index ? { ...slide, ...patch } : slide)))
  }

  const addSlide = (): void => {
    setSlides((prev) => [...prev, { title: '', body: [], layout }])
    setActive(slides.length)
  }

  const setSlideLayout = (kind: 'title' | 'content' | 'section'): void => {
    setLayout(kind)
    updateSlide(active, { layout: kind })
  }

  const removeSlide = (index: number): void => {
    if (slides.length <= 1) return
    setSlides((prev) => prev.filter((_, i) => i !== index))
    setActive((prev) => Math.max(0, prev - 1))
  }

  const insertImage = (): void => {
    fileInputRef.current?.click()
  }

  const onImageChosen = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    if (file === undefined) return
    if (file.size > 2 * 1024 * 1024) { setError('图片不能超过 2MB'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : ''
      if (src === '') return
      updateSlide(active, { image: src, imageMime: file.type })
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const startShow = (): void => {
    if (slides.length === 0) return
    setShowIndex(0)
    setShow(true)
  }

  // Ctrl/Cmd+S saves the deck.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const save = async (): Promise<void> => {
    setStatus(t('editor.saving'))
    try {
      const result = await api.pptSave(path, slides, theme)
      if (!result.ok) { setError(result.error); setStatus('') }
      else { setStatus(t('editor.saved')); setTimeout(() => setStatus(''), 1500) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('')
    }
  }

  const slide = slides[active]

  useEffect(() => {
    if (!show) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShow(false)
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === ' ') {
        setShowIndex((prev) => Math.min(slides.length - 1, prev + 1))
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        setShowIndex((prev) => Math.max(0, prev - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, slides.length])

  if (show) {
    const current = slides[showIndex]
    return (
      <div className={css.slideshow} onClick={() => setShowIndex((prev) => Math.min(slides.length - 1, prev + 1))}>
        <div className={css.slideshowStage}>
          {current?.image !== undefined && <img className={css.slideshowImage} src={current.image} alt="" />}
          <h1 className={css.slideshowTitle}>{current?.title}</h1>
          <div className={css.slideshowBody}>
            {current?.body.map((line, index) => <p key={index}>{line}</p>)}
          </div>
        </div>
        <div className={css.slideshowFooter}>
          <span>{showIndex + 1} / {slides.length}</span>
          <span>{t('ppt.slideShowHint')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={css.container}>
      <div className={css.toolbar}>
        <span className={css.path}>{path}</span>
        <span className={css.spacer} />
        {status !== '' && <span className={css.status}>{status}</span>}
        <select className={css.inputSmall} value={theme} onChange={(event) => setTheme(event.target.value)} title={t('ppt.theme')} style={{ flex: '0 0 auto' }}>
          <option value="blue">{t('ppt.themeBlue')}</option>
          <option value="slate">{t('ppt.themeSlate')}</option>
          <option value="warm">{t('ppt.themeWarm')}</option>
          <option value="forest">{t('ppt.themeForest')}</option>
        </select>
        <select className={css.inputSmall} value={layout} onChange={(event) => setSlideLayout(event.target.value as 'title' | 'content' | 'section')} title={t('ppt.layout')} style={{ flex: '0 0 auto' }}>
          <option value="content">{t('ppt.layoutContent')}</option>
          <option value="title">{t('ppt.layoutTitle')}</option>
          <option value="section">{t('ppt.layoutSection')}</option>
        </select>
        <button type="button" className={css.button} onClick={addSlide}>{t('ppt.addSlide')}</button>
        <button type="button" className={css.button} onClick={insertImage}>{t('ppt.addImage')}</button>
        <button type="button" className={css.button} onClick={startShow}>{t('ppt.slideshow')}</button>
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
            {slide.image !== undefined && (
              <div className={css.pptImageWrap}>
                <img className={css.pptImage} src={slide.image} alt="" />
                <button type="button" className={css.pptThumbDel} onClick={() => updateSlide(active, { image: undefined })}>×</button>
              </div>
            )}
            <textarea
              className={[css.input, css.pptNotesInput].join(' ')}
              placeholder={t('ppt.notes')}
              value={slide.notes ?? ''}
              onChange={(event) => updateSlide(active, { notes: event.target.value })}
            />
          </div>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onImageChosen} />
    </div>
  )
}

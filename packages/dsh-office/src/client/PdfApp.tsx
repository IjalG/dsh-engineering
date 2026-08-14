/**
 * PDF tools: merge / split / convert (LibreOffice) + OCR for images.
 */

import React, { useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeKey } from './locales.ts'
import { OfficeApi } from './api.ts'
import { PdfViewer } from './PdfViewer.tsx'
import css from './office.module.css'

export interface PdfAppProps {
  path: string
  t: Translate<OfficeKey>
}

const api = new OfficeApi()

export function PdfApp({ path, t }: PdfAppProps): React.ReactElement {
  const [mergePaths, setMergePaths] = useState('')
  const [mergeOut, setMergeOut] = useState('merged.pdf')
  const [convertPath, setConvertPath] = useState(path)
  const [ocrPath, setOcrPath] = useState('')
  const [ocrText, setOcrText] = useState('')
  const [pdfOcrBusy, setPdfOcrBusy] = useState(false)
  const [pdfText, setPdfText] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [configured, setConfigured] = useState(false)
  const [libre, setLibre] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void api.probe().then((result) => setLibre(result.libreOffice.available)).catch(() => setLibre(false))
    void api.configGet().then((result) => {
      if (!result.ok) return
      setEndpoint(result.config.visionEndpoint)
      setModel(result.config.visionModel)
      setConfigured(result.config.visionConfigured)
    }).catch(() => {})
  }, [])

  const merge = async (): Promise<void> => {
    const paths = mergePaths.split(',').map((p) => p.trim()).filter(Boolean)
    if (paths.length < 2) return
    setMessage('')
    const result = await api.pdfMerge(paths, mergeOut.trim() || 'merged.pdf')
    setMessage(result.ok ? `${t('pdf.done')}: ${result.pages ?? ''} pages -> ${mergeOut}` : (result.error ?? ''))
  }

  const split = async (): Promise<void> => {
    setMessage('')
    const result = await api.pdfSplit(path)
    setMessage(result.ok ? `${t('pdf.done')}: ${(result.files ?? []).length}` : (result.error ?? ''))
  }

  const convert = async (): Promise<void> => {
    if (!libre) { setMessage(t('pdf.notInstalled')); return }
    setMessage('')
    const result = await api.convert(convertPath)
    setMessage(result.ok ? `${t('pdf.done')}: ${result.outPath ?? ''}` : (result.error ?? ''))
  }

  const ocr = async (): Promise<void> => {
    if (ocrPath.trim() === '') return
    setOcrText('')
    const result = await api.ocrImage(ocrPath.trim())
    setOcrText(result.page.error !== undefined ? `${t('ocr.notConfigured')}: ${result.page.error}` : result.page.text)
  }

  const ocrPdf = async (): Promise<void> => {
    setPdfOcrBusy(true)
    setOcrText('')
    try {
      const result = await api.ocrPdf(path)
      if (!result.ok) { setOcrText(result.error ?? ''); return }
      const parts = (result.pages ?? []).map((page) => {
        const body = page.error !== undefined ? `第${page.page}页: ${page.error}` : `第${page.page}页:\n${page.text}`
        return body
      })
      setOcrText(parts.join('\n\n') || t('ocr.notConfigured'))
    } catch (err) {
      setOcrText(err instanceof Error ? err.message : String(err))
    } finally {
      setPdfOcrBusy(false)
    }
  }

  const extractText = async (): Promise<void> => {
    setPdfText('')
    try {
      const result = await api.pdfText(path)
      setPdfText(result.text ?? result.error ?? '')
    } catch (err) {
      setPdfText(err instanceof Error ? err.message : String(err))
    }
  }

  const saveConfig = async (): Promise<void> => {
    await api.configSet(endpoint.trim(), key.trim(), model.trim())
    setConfigured(endpoint.trim() !== '' && key.trim() !== '')
    setMessage(t('ocr.configured'))
  }

  return (
    <div className={css.container}>
      <div className={css.toolbar}>
        <span className={css.path}>{path}</span>
        <span className={css.spacer} />
        <button type="button" className={css.button} onClick={() => void extractText()}>{t('pdf.extractText')}</button>
        <button type="button" className={css.button} disabled={pdfOcrBusy} onClick={() => void ocrPdf()}>{t('pdf.ocrPages')}</button>
        {message !== '' && <span className={css.status}>{message}</span>}
      </div>
      <div className={css.pdfView}>
        <PdfViewer path={path} t={t} />
      </div>
      {pdfText !== '' && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('pdf.extractText')}</div>
          <pre className={css.ocrText} style={{ maxHeight: 220 }}>{pdfText}</pre>
        </div>
      )}
      <div className={css.section}>
        <div className={css.sectionTitle}>{t('pdf.title')}</div>
        <div className={css.formRow}>
          <input className={css.input} placeholder={t('pdf.mergeHint')} value={mergePaths} onChange={(event) => setMergePaths(event.target.value)} />
          <input className={[css.input, css.inputSmall].join(' ')} placeholder={t('pdf.mergeOut')} value={mergeOut} onChange={(event) => setMergeOut(event.target.value)} />
          <button type="button" className={css.button} onClick={() => void merge()}>{t('pdf.merge')}</button>
        </div>
        <div className={css.formRow}>
          <span className={css.path}>{path}</span>
          <button type="button" className={css.button} onClick={() => void split()}>{t('pdf.split')}</button>
        </div>
        <div className={css.formRow}>
          <input className={css.input} placeholder={t('pdf.convertHint')} value={convertPath} onChange={(event) => setConvertPath(event.target.value)} />
          <button type="button" className={css.button} onClick={() => void convert()}>{t('pdf.convert')}</button>
        </div>
      </div>
      <div className={css.section}>
        <div className={css.sectionTitle}>{t('ocr.title')}</div>
        <div className={css.formRow}>
          <input className={css.input} placeholder={t('ocr.imageHint')} value={ocrPath} onChange={(event) => setOcrPath(event.target.value)} />
          <button type="button" className={css.button} onClick={() => void ocr()}>{t('ocr.run')}</button>
        </div>
        {ocrText !== '' && (
          <div className={css.ocrResult}>
            <div className={css.ocrUntrusted}>{t('ocr.result')}</div>
            <pre className={css.ocrText}>{ocrText}</pre>
          </div>
        )}
        <div className={css.sectionTitle}>{t('ocr.config')}</div>
        <div className={css.formRow}>
          <input className={css.input} placeholder={t('ocr.endpoint')} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
          <input className={css.input} placeholder={t('ocr.key')} type="password" value={key} onChange={(event) => setKey(event.target.value)} />
          <input className={[css.input, css.inputSmall].join(' ')} placeholder={t('ocr.model')} value={model} onChange={(event) => setModel(event.target.value)} />
          <button type="button" className={css.button} onClick={() => void saveConfig()}>{t('ocr.save')}</button>
        </div>
        <div className={css.hint}>{configured ? t('ocr.configured') : t('ocr.notConfigured')}</div>
      </div>
    </div>
  )
}

/**
 * Preset document templates (Word/Excel/PPT) for the new-document flow.
 */

import type { SheetGrid, SlideText } from '../docs.ts'

export interface TemplateDef {
  id: string
  name: string
  kind: 'docx' | 'xlsx' | 'pptx'
  /** Default file name (without extension). */
  defaultName: string
  /** Word: HTML content. */
  html?: string
  /** Excel: preset grids. */
  grids?: SheetGrid[]
  /** PPT: preset slides. */
  slides?: SlideText[]
}

export const WORD_TEMPLATES: TemplateDef[] = [
  {
    id: 'word-blank', name: '空白文档', kind: 'docx', defaultName: '新建文档',
    html: '<p></p>',
  },
  {
    id: 'word-report', name: '工作报告', kind: 'docx', defaultName: '工作报告',
    html: '<h1>工作报告</h1><h2>一、概述</h2><p>（填写本阶段工作概况）</p><h2>二、主要进展</h2><ul><li>进展一</li><li>进展二</li><li>进展三</li></ul><h2>三、数据一览</h2><table><tr><td>指标</td><td>数值</td></tr><tr><td>A</td><td></td></tr><tr><td>B</td><td></td></tr></table><h2>四、下一步计划</h2><p>（填写计划）</p>',
  },
  {
    id: 'word-letter', name: '信函', kind: 'docx', defaultName: '信函',
    html: '<p>尊敬的先生/女士：</p><p></p><p>（正文）</p><p></p><p>此致</p><p>敬礼</p><p></p><p>（署名）</p><p>（日期）</p>',
  },
]

export const EXCEL_TEMPLATES: TemplateDef[] = [
  {
    id: 'xlsx-blank', name: '空白工作簿', kind: 'xlsx', defaultName: '新建工作簿',
    grids: [{ name: 'Sheet1', rows: [['']] }],
  },
  {
    id: 'xlsx-ledger', name: '收支记账', kind: 'xlsx', defaultName: '收支记账',
    grids: [{
      name: '收支',
      rows: [
        ['日期', '摘要', '收入', '支出', '余额'],
        ['', '', '', '', '=C2-D2'],
        ['', '', '', '', '=E2+C3-D3'],
        ['', '', '', '', '=E3+C4-D4'],
        ['', '', '', '', '=E4+C5-D5'],
        ['合计', '', '=SUM(C2:C5)', '=SUM(D2:D5)', ''],
      ],
    }],
  },
  {
    id: 'xlsx-weekly', name: '周报跟踪', kind: 'xlsx', defaultName: '周报跟踪',
    grids: [{
      name: '周报',
      rows: [
        ['项目', '本周进展', '下周计划', '负责人', '状态'],
        ['', '', '', '', ''],
        ['', '', '', '', ''],
        ['', '', '', '', ''],
      ],
    }],
  },
]

export const PPT_TEMPLATES: TemplateDef[] = [
  {
    id: 'pptx-blank', name: '空白演示', kind: 'pptx', defaultName: '新建演示',
    slides: [{ title: '', body: [], layout: 'content' }],
  },
  {
    id: 'pptx-pitch', name: '演示提案', kind: 'pptx', defaultName: '演示提案',
    slides: [
      { title: '演示标题', body: ['副标题'], layout: 'title' },
      { title: '背景与目标', body: ['背景描述', '目标描述'], layout: 'content' },
      { title: '方案要点', body: ['要点一', '要点二', '要点三'], layout: 'content' },
      { title: '下一步', body: ['行动一', '行动二'], layout: 'content' },
    ],
  },
  {
    id: 'pptx-report', name: '汇报演示', kind: 'pptx', defaultName: '汇报演示',
    slides: [
      { title: '工作汇报', body: ['汇报人 · 日期'], layout: 'title' },
      { title: '01', body: ['本期进展'], layout: 'section' },
      { title: '进展概览', body: ['进展一', '进展二', '进展三'], layout: 'content' },
      { title: '02', body: ['数据与成果'], layout: 'section' },
      { title: '数据一览', body: ['指标 A：', '指标 B：', '指标 C：'], layout: 'content' },
      { title: '03', body: ['问题与下一步'], layout: 'section' },
      { title: '下一步计划', body: ['计划一', '计划二'], layout: 'content' },
    ],
  },
]

/** Every template, grouped for the welcome page. */
export const ALL_TEMPLATES: TemplateDef[] = [...WORD_TEMPLATES, ...EXCEL_TEMPLATES, ...PPT_TEMPLATES]

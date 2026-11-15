// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getDefaultNoteFormat,
  setDefaultNoteFormat,
  normalizeNoteFormat,
  type NoteFormat,
} from '../src/learn/noteFormat'
import { renderTypst, convertTypstMathToLatex } from '../src/lib/typst/render'
import { addNoteTo } from '../src/learn/notes'
import { createNote, setNoteFormat } from '../src/learn/graph/notes'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'

describe('笔记源码类型与默认设置 (noteFormat)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('缺省时默认格式为 markdown', () => {
    expect(getDefaultNoteFormat()).toBe('markdown')
  })

  it('支持切换并持久化默认格式', () => {
    setDefaultNoteFormat('typst')
    expect(getDefaultNoteFormat()).toBe('typst')

    setDefaultNoteFormat('html')
    expect(getDefaultNoteFormat()).toBe('html')

    setDefaultNoteFormat('text')
    expect(getDefaultNoteFormat()).toBe('text')

    setDefaultNoteFormat('markdown')
    expect(getDefaultNoteFormat()).toBe('markdown')
  })

  it('容错归一化格式', () => {
    expect(normalizeNoteFormat('plain')).toBe('text')
    expect(normalizeNoteFormat('txt')).toBe('text')
    expect(normalizeNoteFormat('text')).toBe('text')
    expect(normalizeNoteFormat('typst')).toBe('typst')
    expect(normalizeNoteFormat('typ')).toBe('typst')
    expect(normalizeNoteFormat('html')).toBe('html')
    expect(normalizeNoteFormat('htm')).toBe('html')
    expect(normalizeNoteFormat('md')).toBe('markdown')
    expect(normalizeNoteFormat('markdown')).toBe('markdown')
    expect(normalizeNoteFormat('unknown')).toBe('markdown')
  })

  it('创建笔记时自动应用当前默认格式', () => {
    setDefaultNoteFormat('typst')
    const node: KnowledgeNode = {
      id: 'node-1',
      goalId: 'goal-1',
      key: 'test',
      title: '测试节点',
      status: 'learning',
      notes: [],
      annotations: [],
      createdAt: 1000,
      updatedAt: 1000,
    }

    const { node: updatedNode } = addNoteTo(node, '我的Typst笔记', 1000)
    expect(updatedNode.notes?.[0].format).toBe('typst')

    setDefaultNoteFormat('text')
    const { node: updatedNode2 } = addNoteTo(node, '纯文本笔记', 1000)
    expect(updatedNode2.notes?.[0].format).toBe('text')
  })

  it('支持通过 setNoteFormat 切换笔记源码类型', () => {
    const node: KnowledgeNode = {
      id: 'node-1',
      goalId: 'goal-1',
      key: 'test',
      title: '测试节点',
      status: 'learning',
      notes: [
        {
          id: 'note-1',
          name: '算法笔记',
          content: '= 快速排序',
          format: 'markdown',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      annotations: [],
      createdAt: 1000,
      updatedAt: 1000,
    }

    const store: LearnStore = {
      version: 1,
      goals: [{ id: 'goal-1', title: '目标1', rootNodeId: 'node-1', createdAt: 1000, updatedAt: 1000 }],
      nodes: [node],
      edges: [],
      conversations: [],
      drafts: {},
      readingLedger: {},
      docArea: { groups: [], activeGroupId: '' },
      docScroll: {},
      localFiles: [],
    }

    const nextStore = setNoteFormat(store, 'node-1', '算法笔记', 'typst')
    const updated = nextStore.nodes[0].notes?.[0]
    expect(updated?.format).toBe('typst')
  })
})

describe('Typst 语法渲染器 (renderTypst)', () => {
  it('正确将 Typst 数学公式语法转为 LaTeX', () => {
    const latex = convertTypstMathToLatex('alpha + beta / gamma = delta')
    expect(latex).toContain('\\alpha')
    expect(latex).toContain('\\beta')
    expect(latex).toContain('\\gamma')
    expect(latex).toContain('\\delta')
    expect(latex).toContain('\\frac')
  })

  it('渲染 Typst 标题、粗体、斜体、删除线', () => {
    const input = `= 主标题\n== 二级标题\n这里是 *加粗* 和 _斜体_ 以及 ~删除线~`
    const html = renderTypst(input)
    expect(html).toContain('typst-h1')
    expect(html).toContain('主标题')
    expect(html).toContain('typst-h2')
    expect(html).toContain('二级标题')
    expect(html).toContain('typst-bold')
    expect(html).toContain('加粗')
    expect(html).toContain('typst-italic')
    expect(html).toContain('斜体')
    expect(html).toContain('line-through')
  })

  it('渲染 Typst 独立公式与行内公式', () => {
    const input = `公式如下：$E = m c^2$\n\n$ sum_(i=1)^n x_i $`
    const html = renderTypst(input)
    expect(html).toContain('katex')
    expect(html).toContain('typst-math-inline')
    expect(html).toContain('typst-math-block')
  })

  it('渲染 Typst 列表与引用块', () => {
    const input = `- 列表项 1\n- 列表项 2\n\n+ 有序 1\n+ 有序 2\n\n> 重点提示`
    const html = renderTypst(input)
    expect(html).toContain('<ul')
    expect(html).toContain('列表项 1')
    expect(html).toContain('<ol')
    expect(html).toContain('有序 1')
    expect(html).toContain('<blockquote')
    expect(html).toContain('重点提示')
  })

  it('空文本容错', () => {
    expect(renderTypst('')).toContain('空文档')
    expect(renderTypst('   ')).toContain('空文档')
  })
})

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getDefaultNoteFormat,
  setDefaultNoteFormat,
  normalizeNoteFormat,
} from '../src/learn/noteFormat'
import { renderTypst, convertTypstMathToLatex } from '../src/lib/typst/render'
import { addNoteTo } from '../src/learn/notes'
import { setNoteFormat } from '../src/learn/graph/notes'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'

function makeNode(id: string, title: string, goalId = 'g1'): KnowledgeNode {
  return {
    id,
    title,
    key: title.trim().toLowerCase(),
    description: '',
    docs: { teaching: '' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId,
    createdAt: 1000,
    updatedAt: 1000,
  }
}

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
    const node = makeNode('node-1', '测试节点')

    const { node: updatedNode } = addNoteTo(node, '我的Typst笔记', 1000)
    expect(updatedNode.notes?.[0].format).toBe('typst')

    setDefaultNoteFormat('text')
    const { node: updatedNode2 } = addNoteTo(node, '纯文本笔记', 1000)
    expect(updatedNode2.notes?.[0].format).toBe('text')
  })

  it('支持通过 setNoteFormat 切换笔记源码类型', () => {
    const node: KnowledgeNode = {
      ...makeNode('node-1', '测试节点'),
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
    }

    const store: LearnStore = {
      ...emptyLearnStore(),
      nodes: [node],
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

  it('完美渲染真实 Typst 复杂讲义与函数块 (#set, #align, #text, #block, #table, #raw)', () => {
    const sample = `#set document(title: "Typst 语法示例 · 词性九类")
#set page(paper: "a4", margin: 2.5cm, numbering: "1")
#set text(font: ("New Computer Modern", "Noto Serif CJK SC"), size: 11pt, lang: "zh", region: "cn")
#set heading(numbering: "1.")
#set par(justify: true, leading: 0.75em)

#align(center)[
  #text(size: 17pt, weight: "bold")[英语语法 · 词性九类]
  #v(0.3em)
  #text(size: 9.5pt, fill: rgb("#666"))[Typst 语法示例文档]
]

= 核心认知

词性不是单词的属性，而是*位置的属性*。同一个词可以在不同句子里承担不同身份：
_My *work* is hard._ (名词) 与 _I *work* every day._ (动词)。

#block(stroke: (left: 2pt + rgb("#a8432f")), inset: (left: 8pt, y: 6pt))[
  #text(weight: "bold")[铁律：] 英语句子只有一根轴——*主语 + 谓语动词*。判定任何句子，先找那个带时态的动词。
]

= 判定流程

+ 圈出唯一的谓语动词
+ 看左右邻居：限定词后是名词，very 后是形容词或副词
+ 词尾只用来生成假设：#raw("-tion")、#raw("-ment") 多为名词
+ 替换法验证：换成同类词，句子是否仍成立

= 词性分类表

#table(
  columns: (auto, auto, 1fr),
  inset: 8pt,
  align: (left, left, left),
  stroke: 0.5pt + rgb("#999"),
  table.header([*词性*], [*分组*], [*例*]),
  [名词], [实词], [man, door, water],
  [动词], [实词], [run, sleep, study]
)
`
    const html = renderTypst(sample)

    // 1. #set 指令被正确吸收，不作为纯文本泄漏
    expect(html).not.toContain('#set document')
    expect(html).not.toContain('#set page')
    expect(html).not.toContain('#set heading')

    // 2. #align(center) 居中与标题文字渲染
    expect(html).toContain('typst-align')
    expect(html).toContain('text-center')
    expect(html).toContain('英语语法 · 词性九类')
    expect(html).toContain('font-size: 17pt')
    expect(html).toContain('Typst 语法示例文档')

    // 3. 标题编号受 #set heading(numbering: "1.") 驱动
    expect(html).toContain('1. 核心认知')
    expect(html).toContain('2. 判定流程')
    expect(html).toContain('3. 词性分类表')

    // 4. 斜体与粗体嵌套与标点正常生效
    expect(html).toContain('typst-italic')
    expect(html).toContain('typst-bold')
    expect(html).toContain('work')

    // 5. #block 边框与内边距样式解析
    expect(html).toContain('typst-block')
    expect(html).toContain('border-left: 2pt solid #a8432f')
    expect(html).toContain('padding-left: 8pt')
    expect(html).toContain('铁律：')

    // 6. #raw 行内代码转义
    expect(html).toContain('typst-code')
    expect(html).toContain('-tion')
    expect(html).toContain('-ment')

    // 7. #table 表格与表头解析
    expect(html).toContain('typst-table')
    expect(html).toContain('<table')
    expect(html).toContain('<thead')
    expect(html).toContain('词性')
    expect(html).toContain('分组')
    expect(html).toContain('名词')
    expect(html).toContain('man, door, water')
  })
})

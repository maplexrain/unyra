/**
 * 网页 → 正文的**纯逻辑**用例（见 lib/web/page）。
 *
 * 这条链路上需要 DOM 的只有「HTML → 简树」那一步（lib/web/dom），其余全是纯函数：
 * 一棵手写的树就能把「哪些标签成段、列表怎么编号、表格怎么排、代码块语言取哪个」
 * 全部分支钉住。至于抓取本身（体积上限、内网拒绝、编码嗅探），
 * 钉在 electron/web-core 上——那两条合起来，就是「agent 读网页」这件事的全部判断。
 */
import { describe, expect, it } from 'vitest'

import {
  WEB_INLINE_LIMIT,
  absolute,
  fileHeader,
  headingPlain,
  headingsOf,
  needsFile,
  outlineLines,
  sliceSection,
  treeToMarkdown,
  type WebNode,
} from '../src/lib/web/page'

const el = (tag: string, children: WebNode[], attrs: Record<string, string> = {}): WebNode => ({ tag, attrs, children })
const t = (text: string): WebNode => ({ text })

describe('树 → markdown', () => {
  it('标题、段落、粗体、链接（相对地址补全）', () => {
    const md = treeToMarkdown(
      [el('h2', [t('小节')]), el('p', [t('这是'), el('strong', [t('重点')]), t('，见'), el('a', [t('这里')], { href: '/doc' })])],
      'https://e.com/base/page',
    )
    expect(md).toContain('## 小节')
    expect(md).toContain('这是**重点**，见[这里](https://e.com/doc)')
  })

  it('有序列表自己编号，无序列表用短横', () => {
    const md = treeToMarkdown([
      el('ul', [el('li', [t('甲')]), el('li', [t('乙')])]),
      el('ol', [el('li', [t('一')], { __ol: '1' }), el('li', [t('二')], { __ol: '1' })]),
    ])
    expect(md).toContain('- 甲\n- 乙')
    expect(md).toContain('1. 一\n2. 二')
  })

  it('代码块带语言，代码里的井号不会变成标题', () => {
    const md = treeToMarkdown([el('pre', [el('code', [t('# 注释\necho hi')], { class: 'language-sh' })])])
    expect(md).toContain('```sh')
    expect(md).toContain('# 注释')
    expect(headingsOf(md)).toHaveLength(0)
  })

  it('表格：有表头就画分隔行，竖线转义', () => {
    const md = treeToMarkdown([
      el('table', [
        el('thead', [el('tr', [el('th', [t('列 A')]), el('th', [t('列 B')])])]),
        el('tbody', [el('tr', [el('td', [t('1')]), el('td', [t('a|b')])])]),
      ]),
    ])
    expect(md).toContain('| 列 A | 列 B |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('a\\|b')
  })

  it('图片与链接：相对地址补成绝对，页内锚点与 javascript 退成文字', () => {
    const md = treeToMarkdown(
      [
        el('p', [el('img', [], { src: 'img/a.png', alt: '图' })]),
        el('p', [el('a', [t('锚点')], { href: '#top' }), t(' '), el('a', [t('脚本')], { href: 'javascript:void(0)' })]),
      ],
      'https://e.com/x/y',
    )
    expect(md).toContain('![图](https://e.com/x/img/a.png)')
    expect(md).toContain('锚点 脚本')
    expect(md).not.toContain('javascript')
  })

  it('块级元素混进行内时留一个空格，别把两句话粘成一句', () => {
    const md = treeToMarkdown([el('p', [t('前'), el('div', [t('中')]), t('后')])])
    expect(md).toContain('前 中 后')
  })
})

describe('标题与字数', () => {
  const doc = '# 一\n\n甲乙丙\n\n## 二\n\n丁戊\n\n# 三\n\n己\n'

  it('每一节的字数是**自己的正文**（不含子节）', () => {
    expect(headingsOf(doc).map((h) => [h.level, h.text, h.chars])).toEqual([
      [1, '一', 3],
      [2, '二', 2],
      [1, '三', 1],
    ])
  })

  it('大纲行就是「# 标题 - 字数」', () => {
    expect(outlineLines(doc)).toEqual(['# 一 - 3', '## 二 - 2', '# 三 - 1'])
  })

  it('围栏代码块里的井号不是标题', () => {
    const src = '# 真标题\n\n```sh\n# 这行是注释\n```\n\n正文\n'
    expect(headingsOf(src).map((h) => h.text)).toEqual(['真标题'])
  })

  it('行内记号不进标题文字（链接只留文字、去掉星号与代码壳）', () => {
    expect(headingPlain('**重点** 与 [链接](https://e.com) 与 `code`')).toBe('重点 与 链接 与 code')
  })
})

describe('按小节读', () => {
  const doc = '# 一\n\n甲乙丙\n\n## 二\n\n丁戊\n\n# 三\n\n己\n'

  it('给一节就回这一节（含它的子节）', () => {
    const cut = sliceSection(doc, '一')
    expect(cut.ok).toBe(true)
    if (!cut.ok) return
    expect(cut.text).toBe('# 一\n\n甲乙丙\n\n## 二\n\n丁戊')
    expect(cut.subheadings).toEqual(['## 二 - 2'])
  })

  it('路径可以往下走：「一级/二级」', () => {
    const cut = sliceSection(doc, '一/二')
    expect(cut.ok && cut.text).toBe('## 二\n\n丁戊')
  })

  it('找不到就把大纲回给调用方（让它换个说法再试，而不是瞎猜）', () => {
    const cut = sliceSection(doc, '没有这一节')
    expect(cut.ok).toBe(false)
    if (cut.ok) return
    expect(cut.error).toContain('没有找到标题')
    expect(cut.outline).toEqual(['# 一 - 3', '## 二 - 2', '# 三 - 1'])
  })

  it('空的 path 直接说清楚该怎么写', () => {
    const cut = sliceSection(doc, '  ')
    expect(cut.ok).toBe(false)
    if (cut.ok) return
    expect(cut.error).toContain('path 是空的')
  })

  it('索引只在子树里找：同名的二级标题不会跑到别的章里', () => {
    const two = '# A\n\n## 注意\n\n甲\n\n# B\n\n## 注意\n\n乙\n'
    const cut = sliceSection(two, 'B/注意')
    expect(cut.ok && cut.text).toBe('## 注意\n\n乙')
  })
})

describe('阈值与文件头', () => {
  it('超过两万四千字才落盘', () => {
    expect(needsFile('a'.repeat(WEB_INLINE_LIMIT))).toBe(false)
    expect(needsFile('a'.repeat(WEB_INLINE_LIMIT + 1))).toBe(true)
  })

  it('文件头写清来源与抓取时间（用记事本打开也知道这是哪一页）', () => {
    const head = fileHeader({ url: 'https://e.com/a', title: '示例', fetchedAt: Date.UTC(2026, 1, 14, 3, 4, 5) })
    expect(head).toContain('https://e.com/a')
    expect(head).toContain('示例')
    expect(head).toContain('2026-02-14T03:04:05.000Z')
  })

  it('地址补全只认 http/https', () => {
    expect(absolute('/a', 'https://e.com/x/y')).toBe('https://e.com/a')
    expect(absolute('b', 'https://e.com/x/y')).toBe('https://e.com/x/b')
    expect(absolute('mailto:a@b.c', 'https://e.com')).toBe('')
    expect(absolute('javascript:void(0)', 'https://e.com')).toBe('')
    expect(absolute('', 'https://e.com')).toBe('')
  })
})

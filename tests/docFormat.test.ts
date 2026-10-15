/**
 * 文档格式策略的单元用例（见 src/agent/docFormat.ts）。
 *
 * 钉的是三件事：
 * 1. **格式不进系统提示词**——与人格同一套机制（隐藏 user 消息），换格式不作废前缀缓存；
 * 2. 「什么时候该补这一句」的判据：一段对话里同一种格式只补一次，被压缩掉之后要能补回来；
 * 3. 纯 Markdown 策略下 doc-html 模块要被拦掉（HTML 排版配方与策略冲突）。
 */
import { describe, expect, it } from 'vitest'

import type { ConversationMessage } from '../src/agent/types'
import {
  DEFAULT_DOC_FORMAT,
  DOC_FORMATS,
  docFormatAllowsModule,
  docFormatMessage,
  docFormatOf,
  needsDocFormatAnnounce,
} from '../src/agent/docFormat'
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettings } from '../src/agent/settings'
import { buildTeacherSystem } from '../src/learn/ai'
import { toChatHistory } from '../src/learn/useAgent'

const AT = 1700000000000

const userMsg = (text: string, extra: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: 'u' + text.length + Math.round(Math.random() * 999),
  role: 'user',
  parts: [{ type: 'text', text }],
  ts: AT,
  ...extra,
})

describe('三种格式', () => {
  it('三个，id 与短名都在，默认是混合（Markdown 为主）', () => {
    expect(DOC_FORMATS.map((f) => f.id)).toEqual(['hybrid', 'markdown', 'html'])
    expect(DOC_FORMATS.map((f) => f.short)).toEqual(['混合', 'Markdown', 'HTML'])
    expect(docFormatOf(DEFAULT_DOC_FORMAT).label).toBe('混合（Markdown 为主）')
  })

  it('认不出的 id 一律退回默认（老设置文件里根本没有这一项）', () => {
    expect(docFormatOf('markdown').id).toBe('markdown')
    expect(docFormatOf('bogus').id).toBe('hybrid')
    expect(docFormatOf(undefined).id).toBe('hybrid')
  })

  it('每一段指令都是自足的：开头点题；两种覆盖态声明覆盖系统提示词', () => {
    for (const f of DOC_FORMATS) {
      expect(f.instruction).toContain('【文档格式 · ')
      expect(f.instruction).toContain('从现在起')
    }
    // 默认档的立场：Markdown 能实现的用 Markdown，HTML 只作补充
    expect(docFormatOf('hybrid').instruction).toContain('Markdown 能实现的一律用 Markdown')
    // 两种覆盖态必须显式声明「覆盖系统提示词里的排版规范」——不然模型两头看到相反要求
    expect(docFormatOf('markdown').instruction).toContain('覆盖系统提示词')
    expect(docFormatOf('html').instruction).toContain('不借助 Markdown')
    // 纯 Markdown 的硬要求：主流编辑器兼容；纯 HTML 的例外：公式保留 $$
    expect(docFormatOf('markdown').instruction).toContain('兼容性优先')
    expect(docFormatOf('html').instruction).toContain('唯一例外是数学公式')
  })
})

describe('什么时候补这一句（needsDocFormatAnnounce）', () => {
  it('一段刚开的对话：要补', () => {
    expect(needsDocFormatAnnounce([], 'hybrid')).toBe(true)
    expect(needsDocFormatAnnounce([userMsg('你好')], 'hybrid')).toBe(true)
  })

  it('交代过就不再重复（同一种格式只补一次）', () => {
    const messages = [docFormatMessage('hybrid', AT, 'f1'), userMsg('你好')]
    expect(needsDocFormatAnnounce(messages, 'hybrid')).toBe(false)
    // 换一种格式：那是新的一条，要补
    expect(needsDocFormatAnnounce(messages, 'markdown')).toBe(true)
  })

  it('那条被压缩掉（失活）之后要补回来：不然长对话聊到一半会悄悄变回默认排版', () => {
    const messages = [{ ...docFormatMessage('markdown', AT, 'f1'), retired: true }, userMsg('继续')]
    expect(needsDocFormatAnnounce(messages, 'markdown')).toBe(true)
  })
})

describe('那条隐藏消息本身', () => {
  const msg = docFormatMessage('markdown', AT, 'f1')

  it('是 user 角色、隐藏、带 mark 与格式 id', () => {
    expect(msg.role).toBe('user')
    expect(msg.hidden).toBe(true)
    expect(msg.mark).toBe('文档格式 · 纯 Markdown')
    expect(msg.docFormat).toBe('markdown')
    expect(msg.ts).toBe(AT)
  })

  it('正文整段进上下文（隐藏只是界面不显示，模型要看得到）', () => {
    const history = toChatHistory([msg, userMsg('讲一下哈希表')])
    expect(history).toHaveLength(2)
    expect(history[0].role).toBe('user')
    expect(String(history[0].content)).toContain('只用标准 Markdown 语法')
  })
})

describe('不进系统提示词（与人格同一条纪律）', () => {
  it('系统提示词里一个字都不提格式策略（换格式不该让前缀缓存作废）', () => {
    const system = buildTeacherSystem({ goalQuestion: '我想弄懂微积分' })
    expect(system).not.toContain('【文档格式')
    expect(system).not.toContain('覆盖系统提示词')
    expect(system).not.toContain('纯 Markdown')
    expect(system).not.toContain('纯 HTML')
  })
})

describe('LaTeX 兼容性注意事项（用户要求：写在系统提示词里）', () => {
  it('标准、最大程度兼容的核心子集声明在系统提示词里', () => {
    const system = buildTeacherSystem({ goalQuestion: '我想弄懂微积分' })
    expect(system).toContain('LaTeX 兼容性')
    expect(system).toContain('最大程度兼容')
    // 不用 Unicode 字符近似数学（α、x²、√2 这类直接写 LaTeX）
    expect(system).toContain('Unicode')
    // 反斜杠转义要如实落到文本里（模板字符串里的 \\( 必须输出成 \(）
    expect(system).toContain('不用 \\(…\\)')
    expect(system).toContain('\\usepackage')
  })
})

describe('纯 Markdown 拦掉 doc-html（格式与模块的一致性）', () => {
  it('markdown 不放行 doc-html，hybrid / html 放行', () => {
    expect(docFormatAllowsModule('doc-html', 'markdown')).toBe(false)
    expect(docFormatAllowsModule('doc-html', 'hybrid')).toBe(true)
    expect(docFormatAllowsModule('doc-html', 'html')).toBe(true)
  })

  it('别的模块（plot-forms / rich-animation）任何格式都放行', () => {
    for (const f of DOC_FORMATS) {
      expect(docFormatAllowsModule('plot-forms', f.id)).toBe(true)
      expect(docFormatAllowsModule('rich-animation', f.id)).toBe(true)
    }
  })
})

describe('设置里那一项', () => {
  it('默认混合；存过的照读；认不出的退回默认', () => {
    expect(DEFAULT_AGENT_SETTINGS.docFormat).toBe('hybrid')
    expect(normalizeAgentSettings({}).docFormat).toBe('hybrid')
    expect(normalizeAgentSettings({ docFormat: 'markdown' }).docFormat).toBe('markdown')
    expect(normalizeAgentSettings({ docFormat: '混着来' }).docFormat).toBe('hybrid')
    // 别的字段照旧各归各位（新增一项不该动到旧的那些）
    expect(normalizeAgentSettings({ persona: 'adhd', compact: { threshold: 0.5 } }).persona).toBe('adhd')
    expect(normalizeAgentSettings({ compact: { threshold: 0.5 } }).compact.threshold).toBe(0.5)
  })
})

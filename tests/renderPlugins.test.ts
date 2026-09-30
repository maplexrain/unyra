/**
 * 渲染插件：围栏认领、退化与缓存失效（见 lib/renderPlugins、lib/markdown）。
 *
 * 这几条钉的都是「插件坏了/来晚了会怎样」——插件本身能渲染出什么是作者的事，
 * 宿主这一侧要保证的是：没人认领的语法照旧当代码块、插件抛异常不拖垮整篇文档、
 * 新注册的插件对**已经渲染过**的文档也立刻生效（缓存别把旧产物还回来）。
 */
import { describe, expect, it, vi } from 'vitest'

// renderNote 里 DOMPurify.sanitize 需要 document（node 下没有）：换成直通
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }))

import { renderNote } from '../src/lib/markdown'
import { pluginForFence, registerRenderPlugin, renderPlugins, renderPluginsRevision } from '../src/lib/renderPlugins'
import {
  applyBuiltinToggles,
  builtinPlugins,
  compilePlugin,
  pluginCategories,
  pluginCategorySpec,
} from '../src/lib/plugins'

/** 一段围栏：反引号写在常量里，免得这段源码自己把围栏截断 */
const FENCE = '```'
const fence = (lang: string, body: string): string => FENCE + lang + '\n' + body + '\n' + FENCE

describe('渲染插件', () => {
  it('内置的 plot 就是注册表里的一个插件', () => {
    expect(pluginForFence('plot')?.id).toBe('plot')
    expect(renderPlugins().some((p) => p.builtin && p.fences?.includes('plot'))).toBe(true)
    expect(renderNote(fence('plot', '{ "data": [{ "fn": "x^2" }] }'))).toContain('class="moji-plot"')
  })

  it('插件认领的围栏走插件渲染，没人认领的照旧是代码块', () => {
    registerRenderPlugin({
      id: 'test-box',
      name: '方框',
      fences: ['testbox'],
      render: (source: string) => '<div class="test-box">' + source.trim() + '</div>',
    })
    expect(renderNote(fence('testbox', 'hello'))).toContain('<div class="test-box">hello</div>')
    // 没有插件认领 it：marked 的默认渲染，语言标记会留在 class 上
    const plain = renderNote(fence('nobody-claims-this', 'x = 1'))
    expect(plain).toContain('<pre>')
    expect(plain).toContain('x = 1')
  })

  it('语言大小写不敏感，info 串后面的字不参与匹配', () => {
    expect(renderNote(fence('TestBox', 'A'))).toContain('test-box')
    expect(renderNote(fence('testbox title=随便写', 'B'))).toContain('test-box')
  })

  it('插件抛异常：那一段退回代码块，同一篇里的其它内容照常渲染', () => {
    registerRenderPlugin({
      id: 'test-boom',
      fences: ['testboom'],
      render: () => {
        throw new Error('炸了')
      },
    })
    const html = renderNote('# 标题\n\n' + fence('testboom', 'body text'))
    expect(html).toContain('<h1')
    expect(html).toContain('body text')
  })

  it('id 与围栏语言都不许撞车', () => {
    expect(() => registerRenderPlugin({ id: 'test-box', fences: ['testbox2'], render: () => '' })).toThrow()
    expect(() => registerRenderPlugin({ id: 'test-dup-fence', fences: ['testbox'], render: () => '' })).toThrow()
  })

  it('认领了围栏却没有 render：注册时就拒掉', () => {
    expect(() => registerRenderPlugin({ id: 'test-no-render', fences: ['testnorender'] })).toThrow()
  })

  it('新注册的插件对已经渲染过的文档立刻生效（缓存键带插件版本）', () => {
    const source = fence('testlate', 'late')
    // 先渲染一次：此时没人认领，产物是代码块，并且已经进了缓存
    expect(renderNote(source)).toContain('<pre>')
    const before = renderPluginsRevision()
    registerRenderPlugin({
      id: 'test-late',
      fences: ['testlate'],
      render: (src: string) => '<div class="test-late">' + src.trim() + '</div>',
    })
    expect(renderPluginsRevision()).toBeGreaterThan(before)
    // 同一段源文，第二次必须拿到新产物——不带版本号的缓存会在这里把代码块还回来
    expect(renderNote(source)).toContain('test-late')
  })
})

describe('用户插件的编译（new Function 那条路）', () => {
  it('脚本调用 register(...)：id 缺省时取文件名，围栏语言认下来', () => {
    const plugin = compilePlugin(
      'register({ fences: ["testuserbox"], render: (s) => "<b>" + s + "</b>" })',
      'test-user-box.js',
    )
    expect(plugin.id).toBe('test-user-box')
    expect(pluginForFence('testuserbox')?.id).toBe('test-user-box')
    expect(renderNote(fence('testuserbox', 'hi'))).toContain('<b>hi</b>')
  })

  it('module.exports 也认', () => {
    const plugin = compilePlugin('module.exports = { id: "test-user-cjs", name: "CJS", hydrate() {} }', 'x.js')
    expect(plugin.id).toBe('test-user-cjs')
    expect(plugin.name).toBe('CJS')
  })

  it('语法错 / 什么都没交出来 / id 撞车：各自给一句能显示的话', () => {
    expect(() => compilePlugin('register({', 'broken.js')).toThrow()
    // 脚本跑完了但没交出任何东西（module.exports 默认是个空对象）→ 说清缺什么，而不是抛一句英文
    expect(() => compilePlugin('const a = 1', 'empty.js')).toThrow(/什么都没做/)
    expect(() => compilePlugin('register({ id: "plot", hydrate() {} })', 'dup.js')).toThrow(/占用/)
  })
})

describe('围栏之外的钩子（marked 扩展那条路）', () => {
  it('插件给 marked 扩展，就能接行内语法（这里做一个 ==高亮==）', () => {
    registerRenderPlugin({
      id: 'test-mark',
      marked: [
        {
          extensions: [
            {
              name: 'mark',
              level: 'inline',
              start: (src: string) => src.indexOf('=='),
              tokenizer(src: string) {
                const m = /^==([^=\n]+)==/.exec(src)
                if (!m) return undefined
                return { type: 'mark', raw: m[0], text: m[1] }
              },
              renderer(token: { text: string }) {
                return '<mark>' + token.text + '</mark>'
              },
            },
          ],
        },
      ],
    })
    expect(renderNote('这是 ==重点== 一行字')).toContain('<mark>重点</mark>')
    // 围栏照旧不受影响
    expect(renderNote(fence('plot', '{ "data": [{ "fn": "x" }] }'))).toContain('moji-plot')
  })
})

describe('正文文字规则（解析之后的二次加工）', () => {
  it('没命中任何规则时，正文与默认渲染逐字节一致', () => {
    // 这条规则只认「※」，这段文字它碰不到——走的正是「一条都没匹配上」的那条路
    registerRenderPlugin({ id: 'test-text-nohit', text: [{ match: /※※※/g, wrap: 'nope' }] })
    expect(renderNote('引号"与 & 与 →')).toBe('<p>引号&quot;与 &amp; 与 →</p>\n')
    expect(renderNote('a < b')).toBe('<p>a &lt; b</p>\n')
  })

  it('引号染色：只包捕获组，引号留在外面', () => {
    registerRenderPlugin({
      id: 'test-text-quote',
      text: [{ match: /“([^”]+)”/g, wrap: 'moji-quote', group: 1 }],
    })
    expect(renderNote('他说“你好”。')).toContain('他说“<span class="moji-quote">你好</span>”。')
  })

  it('符号换色：用内联样式，不必写 CSS', () => {
    registerRenderPlugin({ id: 'test-text-arrow', text: [{ match: /[→←]/g, style: 'color:#c0392b' }] })
    expect(renderNote('a → b')).toContain('<span style="color:#c0392b">→</span>')
  })

  it('代码块与行内代码不受影响（它们是别的令牌，压根不是正文文字）', () => {
    expect(renderNote('`→`')).toContain('<code>→</code>')
    const block = renderNote(fence('', '→'))
    expect(block).toContain('→')
    expect(block).not.toContain('color:#c0392b')
  })

  it('两条规则撞上同一段文字：先注册的赢，不会套两层', () => {
    registerRenderPlugin({ id: 'test-text-first', text: [{ match: /★/g, wrap: 'first' }] })
    registerRenderPlugin({ id: 'test-text-second', text: [{ match: /★/g, wrap: 'second' }] })
    const html = renderNote('★★')
    expect(html).toContain('class="first"')
    expect(html).not.toContain('class="second"')
    expect(html.match(/<span/g)?.length).toBe(2)
  })

  it('规则写得不完整：注册时就点明缺什么', () => {
    expect(() => registerRenderPlugin({ id: 'test-bad-1', text: [{ wrap: 'a' }] })).toThrow(/match/)
    expect(() => registerRenderPlugin({ id: 'test-bad-2', text: [{ match: /a/ }] })).toThrow(/wrap/)
  })
})

describe('插件宿主：类别与内置插件的开关', () => {
  it('插件归到类别下；不写 category 时按 Markdown 文档插件算', () => {
    const plugin = registerRenderPlugin({ id: 'test-cat', fences: ['testcat'], render: () => '' })
    expect(plugin.category).toBe('markdown')
    expect(pluginCategories().map((c) => c.id)).toContain('markdown')
  })

  it('内置插件默认开，而且是编译进包的那一份', () => {
    const plot = builtinPlugins().find((p) => p.id === 'plot')
    expect(plot?.builtin).toBe(true)
    expect(plot?.defaultEnabled).toBe(true)
    // 设置页那一行摘要来自类别的 describe
    expect(pluginCategorySpec('markdown').describe(plot!)).toContain('```plot')
  })

  it('内置插件不许带 marked 扩展：那玩意儿装上去摘不下来，关不掉', () => {
    expect(() =>
      registerRenderPlugin({ id: 'test-builtin-marked', builtin: true, marked: [{}] }),
    ).toThrow(/marked/)
  })

  it('开关为空（没改过）时内置插件照旧在', () => {
    applyBuiltinToggles({})
    expect(pluginForFence('plot')).toBeTruthy()
  })

  it('记成 false 的内置插件会被注销：围栏退回代码块', () => {
    // 放在最后：注销之后本文件不再需要 plot（它是注册表里的全局状态）
    applyBuiltinToggles({ plot: false })
    expect(pluginForFence('plot')).toBeUndefined()
    expect(renderNote(fence('plot', '{ "data": [] }'))).toContain('<pre>')
  })
})

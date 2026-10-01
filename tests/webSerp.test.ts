// @vitest-environment happy-dom
/**
 * SERP 解析与搜索地址的用例（见 lib/web/serp 与 learn/webSearch）。
 *
 * 断言只写「输入什么 HTML、得到什么结果」：每家引擎给一份按其结果块结构裁出来的
 * 最小样本（容器 / 标题链接 / 摘要与真实页面同构），解析不出（验证码页、空 HTML）
 * 就必须回空数组——调用方据此把「换一个引擎」说进回执，绝不静默吞掉。
 * DOMParser 由 happy-dom 提供（文件头的 environment pragma），生产里是渲染层的原生实现。
 */
import { describe, expect, it } from 'vitest'
import { parseSerp, serpUrl, SEARCH_ENGINES } from '../src/lib/web/serp'

describe('serpUrl', () => {
  it('五家引擎的地址各就各位', () => {
    expect(serpUrl('baidu', '勾股定理')).toBe('https://www.baidu.com/s?wd=' + encodeURIComponent('勾股定理') + '&rn=20')
    expect(serpUrl('bing', 'pythagorean theorem')).toContain('https://www.bing.com/search?q=')
    expect(serpUrl('google', 'gradient descent')).toContain('gbv=1')
    expect(serpUrl('yandex', 'математика')).toContain('https://yandex.com/search/?text=')
  })

  it('wikipedia 的语言：合法的照用，不合法的回 zh', () => {
    expect(serpUrl('wikipedia', '机器学习', { lang: 'en' })).toContain('https://en.wikipedia.org/w/api.php')
    expect(serpUrl('wikipedia', '机器学习', { lang: '../evil' })).toContain('https://zh.wikipedia.org/w/api.php')
    expect(serpUrl('wikipedia', '机器学习')).toContain('srsearch=')
  })
})

describe('parseSerp', () => {
  it('baidu：标题、跳转链补全与摘要', () => {
    const html = `
      <div class="result">
        <h3><a href="/link?url=abc123">勾股定理 - 百度百科</a></h3>
        <div class="c-abstract">直角三角形两直角边的平方和等于斜边的平方。</div>
      </div>
      <div class="result c-container">
        <h3><a href="https://www.example.com/proof">勾股定理的证明</a></h3>
        <div class="c-abstract">欧几里得《几何原本》给出了最早的证明。</div>
      </div>`
    const rs = parseSerp('baidu', html)
    expect(rs).toHaveLength(2)
    expect(rs[0]!.title).toBe('勾股定理 - 百度百科')
    expect(rs[0]!.url).toBe('https://www.baidu.com/link?url=abc123')
    expect(rs[0]!.snippet).toContain('平方和')
    expect(rs[1]!.url).toBe('https://www.example.com/proof')
  })

  it('bing：标题、链接与摘要', () => {
    const html = `
      <li class="b_algo">
        <h2><a href="https://example.com/pythagoras">Pythagorean theorem - Wikipedia</a></h2>
        <div class="b_caption"><p>In mathematics, the Pythagorean theorem relates the sides of a right triangle.</p></div>
      </li>`
    const rs = parseSerp('bing', html)
    expect(rs).toHaveLength(1)
    expect(rs[0]!.title).toBe('Pythagorean theorem - Wikipedia')
    expect(rs[0]!.url).toBe('https://example.com/pythagoras')
    expect(rs[0]!.snippet).toContain('right triangle')
  })

  it('bing 的跳转链解回真实地址（读原文不必再过会 403 的跳转器）', () => {
    // u 参数 = 'a1' + base64url('https://example.com/real')，与真实 /ck/a 链同构
    const encoded = Buffer.from('https://example.com/real', 'utf-8').toString('base64url')
    const html = `
      <li class="b_algo">
        <h2><a href="https://www.bing.com/ck/a?!&p=abc&u=a1${encoded}&ntb=1">Real Title</a></h2>
        <div class="b_caption"><p>snippet</p></div>
      </li>`
    const rs = parseSerp('bing', html)
    expect(rs).toHaveLength(1)
    expect(rs[0]!.url).toBe('https://example.com/real')
    // 解不出的跳转链原样保留（不猜）
    const html2 = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?p=xyz">Odd</a></h2><p>s</p></li>`
    expect(parseSerp('bing', html2)[0]!.url).toBe('https://www.bing.com/ck/a?p=xyz')
  })

  it('google 免 JS 版：/url?q= 包装链被解回真地址', () => {
    const html = `
      <div class="g">
        <a href="/url?q=https://example.com/gd&sa=U"><h3>Gradient descent - Wikipedia</h3></a>
        <div class="VwiC3b">Gradient descent is a first-order iterative optimization algorithm.</div>
      </div>`
    const rs = parseSerp('google', html)
    expect(rs).toHaveLength(1)
    expect(rs[0]!.url).toBe('https://example.com/gd')
    expect(rs[0]!.title).toBe('Gradient descent - Wikipedia')
    expect(rs[0]!.snippet).toContain('optimization')
  })

  it('yandex：标题与摘要', () => {
    const html = `
      <li class="serp-item">
        <a class="OrganicTitle-Link" href="https://example.com/y"><h2>Теорема Пифагора</h2></a>
        <span class="OrganicTextContentSpan">Теорема Пифагора — одна из основополагающих теорем евклидовой геометрии.</span>
      </li>`
    const rs = parseSerp('yandex', html)
    expect(rs).toHaveLength(1)
    expect(rs[0]!.url).toBe('https://example.com/y')
    expect(rs[0]!.snippet).toContain('геометрии')
  })

  it('wikipedia：官方 API 的 JSON，摘要剥掉高亮标签，链接落到对应语言的站点', () => {
    const json = JSON.stringify({
      query: {
        search: [
          { title: '机器学习', snippet: '<span class="searchmatch">机器学习</span>是人工智能的一个分支' },
          { title: ' supervised learning', snippet: 'Supervised learning is a machine learning paradigm' },
        ],
      },
    })
    const rs = parseSerp('wikipedia', json, { lang: 'zh' })
    expect(rs).toHaveLength(2)
    expect(rs[0]!.title).toBe('机器学习')
    expect(rs[0]!.url).toBe('https://zh.wikipedia.org/wiki/' + encodeURIComponent('机器学习'))
    expect(rs[0]!.snippet).not.toContain('<span')
    expect(rs[1]!.url).toContain('https://zh.wikipedia.org/wiki/supervised')
  })

  it('重复链接去重；没有链接的块跳过', () => {
    const html = `
      <li class="b_algo"><h2><a href="https://example.com/dup">Dup</a></h2><p>one</p></li>
      <li class="b_algo"><h2><a href="https://example.com/dup">Dup again</a></h2><p>two</p></li>
      <li class="b_algo"><div>没有链接的一块</div></li>`
    const rs = parseSerp('bing', html)
    expect(rs).toHaveLength(1)
  })

  it('验证码页 / 空结果解析为空数组（不抛异常）', () => {
    expect(parseSerp('baidu', '<html><body>百度安全验证</body></html>')).toEqual([])
    expect(parseSerp('bing', '')).toEqual([])
    expect(parseSerp('wikipedia', 'not json at all')).toEqual([])
  })

  it('引擎表与文档口径一致：五家', () => {
    expect(SEARCH_ENGINES).toEqual(['baidu', 'bing', 'google', 'yandex', 'wikipedia'])
  })
})

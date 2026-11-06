// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { makeBrowserOps, type BrowserDeps } from '../src/learn/web/browserOps'
import { buildApi } from '../src/agent/sandbox/api'
import type { BrowserOps } from '../src/agent/sandbox/types'
import type { LearnStore, TabRef, WebTabMeta } from '../src/learn/types'

/** web 页签 fixture：id 直接用 'w:'+key，与 tabKey 的口径一致 */
function webTab(key: string, url: string) {
  return { id: 'w:' + key, ref: { kind: 'web', url, key } as TabRef, createdAt: 0 }
}

/** 最小 store：browserOps 只读 docArea（groups 的页签与激活态） */
function storeWith(tabs: ReturnType<typeof webTab>[], active: string | null): LearnStore {
  return {
    docArea: {
      layout: {} as never,
      groups: [{ id: 'g1', tabs, active }],
      focus: 'g1',
    },
  } as unknown as LearnStore
}

function makeDeps(store: LearnStore, webMeta: Record<string, WebTabMeta> = {}) {
  const opened: string[] = []
  const activated: string[] = []
  const closed: Array<[string, string]> = []
  const execCalls: Array<[string, string]> = []

  const deps: BrowserDeps = {
    getLatest: () => store,
    set: () => {},
    openWebTab: (url) => {
      opened.push(url)
      return 'w:newkey'
    },
    activateTab: (id) => {
      activated.push(id)
    },
    closeTab: (group, id) => {
      closed.push([group, id])
    },
    webMeta,
    execJs: async (tabId, script) => {
      execCalls.push([tabId, script])
      if (script.includes('window.__agentIndex(')) {
        return { text: '[1] header\n[2] button "点赞"', count: 2, title: '测试页', url: 'https://example.com' }
      }
      if (script.includes('window.__agentText(')) {
        return { ok: true, id: 4, text: '文章正文内容', totalChars: 6, offset: 0, hasMore: false }
      }
      if (script.includes('window.__agentInspect(')) {
        return { ok: true, id: 2, tag: 'button', value: undefined, disabled: false, rect: { x: 10, y: 20, width: 80, height: 32 } }
      }
      if (script.includes('window.__agentClick(')) {
        return { ok: true, tag: 'button' }
      }
      if (script.includes('window.__agentFill(')) {
        return { ok: true, tag: 'input', resolvedTag: 'input', resolvedType: 'input' }
      }
      if (script.includes('window.__agentType(')) {
        return { ok: true, tag: 'bili-comment-rich-textarea', resolvedTag: 'div', typedChars: 5 }
      }
      if (script.includes('window.__agentPress(')) {
        return { ok: true, key: 'Enter' }
      }
      if (script.includes('window.__agentScroll(')) {
        return { ok: true, scrollY: 800, scrollHeight: 3000, atBottom: false }
      }
      if (script.includes('window.__agentQuery(')) {
        return { ok: true, selector: 'button', count: 1, matches: [{ id: 1, tag: 'button', text: '按钮', visible: true, isEditable: false, rect: { x: 0, y: 0, width: 10, height: 10 } }] }
      }
      if (script.includes('window.__agentWaitFor(')) {
        return { ok: true, elapsedMs: 50, id: 1, tag: 'button' }
      }
      if (script.includes('__agentPrepareElementCapture("article"')) {
        return { ok: true, token: 'tok1', tag: 'article', totalWidth: 800, totalHeight: 1200, directDataUrl: 'data:image/png;base64,AAAA' }
      }
      if (script.includes('window.__agentEval(')) {
        return { ok: true, result: '执行结果' }
      }
      return { ok: true }
    },
  }
  return { deps, opened, activated, closed, execCalls }
}

const META: WebTabMeta = { url: 'https://x.com/a', loading: false, canBack: false, canFwd: false, error: null }

describe('makeBrowserOps：browser.* 基础生命周期与读写动作', () => {
  it('open / tabs / activate / close 生命周期操作正常工作', async () => {
    const store = storeWith([webTab('a', 'https://x.com/a'), webTab('b', 'https://y.com')], 'w:a')
    const { deps, opened, activated, closed } = makeDeps(store, { 'w:a': { ...META, title: 'X 首页' } })
    const ops = makeBrowserOps(deps)

    const r = await ops.open('example.com')
    expect(r).toEqual({ tabId: 'w:newkey', url: 'https://example.com' })
    expect(opened).toEqual(['https://example.com'])
    await expect(ops.open('  ')).rejects.toThrow('要给出网址')

    expect(ops.tabs()).toEqual({
      tabs: [
        { tabId: 'w:a', url: 'https://x.com/a', title: 'X 首页', active: true, group: 'g1' },
        { tabId: 'w:b', url: 'https://y.com', title: 'y.com', active: false, group: 'g1' },
      ],
    })

    expect(ops.activate('w:a')).toEqual({ ok: true })
    expect(activated).toEqual(['w:a'])
    expect(ops.close('w:a')).toEqual({ ok: true })
    expect(ops.close(['w:a', 'w:b'])).toEqual({ ok: true })
    expect(closed).toEqual([['g1', 'w:a'], ['g1', 'w:a'], ['g1', 'w:b']])
    expect(() => ops.activate('w:ghost')).toThrow('没有这个网页页签')
    expect(() => ops.close('w:ghost')).toThrow('没有这个网页页签')
  })

  it('基础读操作（index / text / inspect）正常派发并支持省略 tabId 取当前焦点页签', async () => {
    const store = storeWith([webTab('a', 'https://x.com/a')], 'w:a')
    const { deps, execCalls } = makeDeps(store)
    const ops = makeBrowserOps(deps)

    // 1. index 省略 tabId
    const indexRes = await ops.index(undefined, { focus: 1 })
    expect(indexRes.text).toContain('[1] header')
    expect(execCalls[0][0]).toBe('w:a')
    expect(execCalls[0][1]).toContain('__agentIndex({"focus":1})')

    // 2. text 读取正文
    const textRes = await ops.text('w:a', 4, { maxChars: 2000 })
    expect(textRes.text).toBe('文章正文内容')
    expect(execCalls[1][0]).toBe('w:a')
    expect(execCalls[1][1]).toContain('__agentText(4')

    // 3. inspect 探查属性
    const inspectRes = await ops.inspect(undefined, 2)
    expect(inspectRes.tag).toBe('button')
    expect(inspectRes.rect?.width).toBe(80)
    expect(execCalls[2][0]).toBe('w:a')
    expect(execCalls[2][1]).toContain('__agentInspect(2')
  })

  it('基础写操作（click / fill / press / scroll）正常派发', async () => {
    const store = storeWith([webTab('a', 'https://x.com/a')], 'w:a')
    const { deps, execCalls } = makeDeps(store)
    const ops = makeBrowserOps(deps)

    // 1. click 点击
    const clickRes = await ops.click(undefined, 2, { waitAfterMs: 10 })
    expect(clickRes).toEqual({ ok: true, tag: 'button' })
    expect(execCalls[0][1]).toContain('__agentClick(2')

    // 2. fill 输入
    const fillRes = await ops.fill('w:a', 3, '微积分', { pressEnter: true })
    expect(fillRes).toEqual({ ok: true, tag: 'input', resolvedTag: 'input', resolvedType: 'input' })
    expect(execCalls[1][1]).toContain('__agentFill(3, "微积分"')

    // 2.5 type 逐字符输入
    const typeRes = await ops.type('w:a', 25, 'hello')
    expect(typeRes).toEqual({ ok: true, tag: 'bili-comment-rich-textarea', resolvedTag: 'div', typedChars: 5 })
    expect(execCalls[2][1]).toContain('__agentType(25, "hello"')

    // 3. press 模拟按键
    const pressRes = await ops.press(undefined, 'Enter', 3)
    expect(pressRes).toEqual({ ok: true, key: 'Enter' })
    expect(execCalls[3][1]).toContain('__agentPress("Enter", 3)')

    // 4. scroll 滚动
    const scrollRes = await ops.scroll('w:a', { by: 800 })
    expect(scrollRes.atBottom).toBe(false)
    expect(execCalls[4][1]).toContain('__agentScroll')

    // 5. query 检索
    const queryRes = await ops.query('w:a', 'button')
    expect(queryRes.count).toBe(1)
    expect(execCalls[5][1]).toContain('__agentQuery("button"')

    // 6. waitFor 等待
    const waitRes = await ops.waitFor(undefined, '.brt-btn', { timeoutMs: 2000 })
    expect(waitRes.ok).toBe(true)
    expect(execCalls[6][1]).toContain('__agentWaitFor(".brt-btn"')

    // 7. eval 页面代码执行
    const evalRes = await ops.eval('w:a', 'document.title')
    expect(evalRes.result).toBe('执行结果')
    expect(execCalls[7][1]).toContain('__agentEval("document.title")')

    // 8. toImage 元素截图
    const imgRes = await ops.toImage('w:a', 'article', { isolate: true, full: true })
    expect(imgRes.ok).toBe(true)
    expect(imgRes.tag).toBe('article')
    expect(execCalls[8][1]).toContain('__agentPrepareElementCapture("article"')
  })
})

describe('buildApi：browser.* 参数兼容性与宽容解析', () => {
  it('正确解析 undefined/null 占位符、省略 tabId 以及单对象传参', async () => {
    let captured: Record<string, unknown> = {}
    const mockBrowser: BrowserOps = {
      open: async () => ({ tabId: 'w:1', url: 'https://example.com' }),
      tabs: () => ({ tabs: [] }),
      activate: () => ({ ok: true as const }),
      close: () => ({ ok: true as const }),
      index: async (tabId, opts) => { captured = { tabId, opts }; return { text: '', count: 0, title: '', url: '' } },
      text: async (tabId, target, opts) => { captured = { tabId, target, opts }; return { ok: true, id: target, text: '', totalChars: 0 } },
      inspect: async (tabId, target) => { captured = { tabId, target }; return { ok: true, id: target, tag: 'div' } },
      click: async (tabId, target, opts) => { captured = { tabId, target, opts }; return { ok: true } },
      fill: async (tabId, target, text, opts) => { captured = { tabId, target, text, opts }; return { ok: true } },
      type: async (tabId, target, text, opts) => { captured = { tabId, target, text, opts }; return { ok: true } },
      press: async (tabId, key, target) => { captured = { tabId, key, target }; return { ok: true } },
      scroll: async (tabId, opts) => { captured = { tabId, opts }; return { ok: true } },
      query: async (tabId, selector, opts) => { captured = { tabId, selector, opts }; return { ok: true, selector, count: 0, matches: [] } },
      waitFor: async (tabId, targetOrText, opts) => { captured = { tabId, targetOrText, opts }; return { ok: true, elapsedMs: 10 } },
      screenshot: async (tabId, opts) => { captured = { tabId, opts }; return { ok: true, url: 'moji:static/1' } },
      eval: async (tabId, code) => { captured = { tabId, code }; return { ok: true, result: 42 } },
      toImage: async (tabId, target, opts) => { captured = { tabId, target, opts }; return { ok: true, url: 'moji:static/1' } },
      elementImage: async (tabId, target, opts) => { captured = { tabId, target, opts }; return { ok: true, url: 'moji:static/1' } },
      elementScreenshot: async (tabId, target, opts) => { captured = { tabId, target, opts }; return { ok: true, url: 'moji:static/1' } },
    }

    const { api } = buildApi({ browser: mockBrowser } as any, [])
    const b = (api as any).browser

    // 1. 位置参数传 undefined 占位（解决实测中报“目标需要给出节点编号”）
    await b.text(undefined, 10, { maxChars: 500 })
    expect(captured).toEqual({ tabId: undefined, target: 10, opts: { maxChars: 500 } })

    // 2. 位置参数传 null 占位
    await b.fill(null, 25, 'test')
    expect(captured).toEqual({ tabId: undefined, target: 25, text: 'test', opts: {} })

    // 3. 省略 tabId，第一参直接是 target
    await b.click(12, { waitAfterMs: 50 })
    expect(captured).toEqual({ tabId: undefined, target: 12, opts: { waitAfterMs: 50 } })

    // 4. 第一参显式给出 tabId
    await b.type('w:tab1', 25, 'hello')
    expect(captured).toEqual({ tabId: 'w:tab1', target: 25, text: 'hello', opts: {} })

    // 5. 单对象传参模式：{ target, ... }
    await b.text({ target: 15, maxChars: 1000 })
    expect(captured).toEqual({ tabId: undefined, target: 15, opts: expect.objectContaining({ target: 15, maxChars: 1000 }) })

    await b.fill({ tabId: 'w:tab2', target: 24, text: '评论' })
    expect(captured).toEqual({ tabId: 'w:tab2', target: 24, text: '评论', opts: expect.objectContaining({ tabId: 'w:tab2', target: 24, text: '评论' }) })

    // 6. query 与 waitFor 宽容传参
    await b.query('.brt-btn', { limit: 10 })
    expect(captured).toEqual({ tabId: undefined, selector: '.brt-btn', opts: { limit: 10 } })

    await b.waitFor('发布成功', { timeoutMs: 3000 })
    expect(captured).toEqual({ tabId: undefined, targetOrText: '发布成功', opts: { timeoutMs: 3000 } })

    // 7. eval 脚本执行
    await b.eval('window.location.href')
    expect(captured).toEqual({ tabId: undefined, code: 'window.location.href' })

    // 8. screenshot 截图
    await b.screenshot({ path: 'custom.png' })
    expect(captured).toEqual({ tabId: undefined, opts: { path: 'custom.png' } })

    // 9. toImage 与 elementImage 元素截图
    await b.toImage('article', { isolate: true, full: true })
    expect(captured).toEqual({ tabId: undefined, target: 'article', opts: { isolate: true, full: true } })

    await b.elementImage(25, { padding: 10 })
    expect(captured).toEqual({ tabId: undefined, target: 25, opts: { padding: 10 } })
    await b.elementScreenshot('#main')
    expect(captured).toEqual({ tabId: undefined, target: '#main', opts: {} })
  })

  it('api.ask 针对 short 简答题空值时自动保底返回 value: ""', async () => {
    const mockAsk = async () => ({
      answers: [
        { id: 'q1', type: 'short', prompt: '用户感想' } // 没有 value 字段
      ]
    })
    const { api } = buildApi({ ask: mockAsk } as any, [])
    const res = await (api as any).ask({
      title: '调查问卷',
      questions: [{ id: 'q1', type: 'short', prompt: '用户感想' }]
    })
    expect(res.answers[0].value).toBe('')
    expect(res.answers[0].text).toBe('')
  })
})

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { makeBrowserOps, type BrowserDeps } from '../src/learn/web/browserOps'
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
        return { ok: true, tag: 'input' }
      }
      if (script.includes('window.__agentPress(')) {
        return { ok: true, key: 'Enter' }
      }
      if (script.includes('window.__agentScroll(')) {
        return { ok: true, scrollY: 800, scrollHeight: 3000, atBottom: false }
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
    expect(execCalls[0][1]).toContain('__agentIndex(1)')

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
    expect(execCalls[2][1]).toContain('__agentInspect(2)')
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
    expect(fillRes).toEqual({ ok: true, tag: 'input' })
    expect(execCalls[1][1]).toContain('__agentFill(3, "微积分"')

    // 3. press 模拟按键
    const pressRes = await ops.press(undefined, 'Enter', 3)
    expect(pressRes).toEqual({ ok: true, key: 'Enter' })
    expect(execCalls[2][1]).toContain('__agentPress("Enter", 3)')

    // 4. scroll 滚动
    const scrollRes = await ops.scroll('w:a', { by: 800 })
    expect(scrollRes.atBottom).toBe(false)
    expect(execCalls[3][1]).toContain('__agentScroll')
  })
})

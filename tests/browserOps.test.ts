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
  }
  return { deps, opened, activated, closed }
}

const META: WebTabMeta = { url: 'https://x.com/a', loading: false, canBack: false, canFwd: false, error: null }

describe('makeBrowserOps：browser.* 的宿主实现（生命周期基础操作）', () => {
  it('open 归一网址后交给宿主开签；空网址拒绝', async () => {
    const { deps, opened } = makeDeps(storeWith([], null))
    const ops = makeBrowserOps(deps)
    const r = await ops.open('example.com')
    expect(r).toEqual({ tabId: 'w:newkey', url: 'https://example.com' })
    expect(opened).toEqual(['https://example.com'])
    await expect(ops.open('  ')).rejects.toThrow('要给出网址')
  })

  it('tabs 列出存活的网页页签（{tabs} 信封，同组一致）：真标题优先、缺了用域名兜底，active 标激活', () => {
    const store = storeWith([webTab('a', 'https://x.com/a'), webTab('b', 'https://y.com')], 'w:a')
    const { deps } = makeDeps(store, { 'w:a': { ...META, title: 'X 首页' } })
    const ops = makeBrowserOps(deps)
    expect(ops.tabs()).toEqual({
      tabs: [
        { tabId: 'w:a', url: 'https://x.com/a', title: 'X 首页', active: true, group: 'g1' },
        { tabId: 'w:b', url: 'https://y.com', title: 'y.com', active: false, group: 'g1' },
      ],
    })
  })

  it('activate / close 落到宿主动作；close 认数组批量；不存在的页签报错', () => {
    const { deps, activated, closed } = makeDeps(storeWith([webTab('a', 'https://x.com'), webTab('b', 'https://y.com')], 'w:a'))
    const ops = makeBrowserOps(deps)
    expect(ops.activate('w:a')).toEqual({ ok: true })
    expect(activated).toEqual(['w:a'])
    expect(ops.close('w:a')).toEqual({ ok: true })
    expect(ops.close(['w:a', 'w:b'])).toEqual({ ok: true })
    expect(closed).toEqual([['g1', 'w:a'], ['g1', 'w:a'], ['g1', 'w:b']])
    expect(() => ops.activate('w:ghost')).toThrow('没有这个网页页签')
    expect(() => ops.close('w:ghost')).toThrow('没有这个网页页签')
  })
})

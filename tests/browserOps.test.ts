import { describe, expect, it } from 'vitest'
import type { WebviewTag } from 'electron'
import { makeBrowserOps, type BrowserDeps } from '../src/learn/web/browserOps'
import { registerWebview } from '../src/learn/web/webviewRegistry'
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

describe('makeBrowserOps：browser.* 的宿主实现（纯逻辑，Node 里可测）', () => {
  it('open 归一网址后交给宿主开签；空网址拒绝', async () => {
    const { deps, opened } = makeDeps(storeWith([], null))
    const ops = makeBrowserOps(deps, 'goal1')
    // 注册表里没有元素：open 不等待，note 说明「还在挂载」
    const r = await ops.open('example.com')
    expect(r).toEqual({ tabId: 'w:newkey', url: 'https://example.com', note: expect.any(String) })
    expect(opened).toEqual(['https://example.com'])
    await expect(ops.open('  ')).rejects.toThrow('要给出网址')
  })

  it('open 拿得到元素时会等加载稳定（isLoading 立即为 false 就直接过）', async () => {
    const { deps } = makeDeps(storeWith([], null))
    const ops = makeBrowserOps(deps, 'goal1')
    registerWebview('w:newkey', { isLoading: () => false } as unknown as WebviewTag)
    try {
      const r = await ops.open('https://example.com')
      expect(r).toEqual({ tabId: 'w:newkey', url: 'https://example.com' })
    } finally {
      registerWebview('w:newkey', null)
    }
  })

  it('tabs 列出存活的网页页签：真标题优先、缺了用域名兜底，active 标激活', () => {
    const store = storeWith([webTab('a', 'https://x.com/a'), webTab('b', 'https://y.com')], 'w:a')
    const { deps } = makeDeps(store, { 'w:a': { ...META, title: 'X 首页' } })
    const ops = makeBrowserOps(deps, 'goal1')
    expect(ops.tabs()).toEqual([
      { tabId: 'w:a', url: 'https://x.com/a', title: 'X 首页', active: true, group: 'g1' },
      { tabId: 'w:b', url: 'https://y.com', title: 'y.com', active: false, group: 'g1' },
    ])
  })

  it('指名不存在的页签、或焦点格没有网页时，报错并引导先 tabs()', async () => {
    const { deps } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    await expect(ops.read('w:ghost')).rejects.toThrow('没有这个网页页签')
    await expect(ops.eval('w:ghost', '1')).rejects.toThrow('没有这个网页页签')
    // 指的是焦点格的网页，但元素没挂上（刚重启回来）：元素级的错
    await expect(ops.read(undefined)).rejects.toThrow('网页元素不在了')
    // 焦点格激活的不是网页
    const ops2 = makeBrowserOps(makeDeps(storeWith([], null)).deps, 'goal1')
    await expect(ops2.capture(undefined)).rejects.toThrow('焦点格里没有正看着的网页页签')
  })

  it('activate / close 落到宿主动作；不存在的页签报错', () => {
    const { deps, activated, closed } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    expect(ops.activate('w:a')).toEqual({ ok: true })
    expect(activated).toEqual(['w:a'])
    expect(ops.close('w:a')).toEqual({ ok: true })
    expect(closed).toEqual([['g1', 'w:a']])
    expect(() => ops.activate('w:ghost')).toThrow('没有这个网页页签')
    expect(() => ops.close('w:ghost')).toThrow('没有这个网页页签')
  })

  it('eval 校验代码必须是字符串', async () => {
    const { deps } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    await expect(ops.eval(undefined, '  ')).rejects.toThrow('要给一段 JS 源码字符串')
  })
})

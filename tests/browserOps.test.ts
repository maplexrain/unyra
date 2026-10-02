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
  const snapshotted: number[] = []
  const located: Array<[number, { ref: number } | { selector: string }]> = []
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
    snapshot: async (wcId) => {
      snapshotted.push(wcId)
      return { elements: [{ ref: 1, role: 'button', name: '提交' }] }
    },
    locate: async (wcId, target) => {
      located.push([wcId, target])
      // ref=2 是「过期 ref」的哨兵
      if ('ref' in target && target.ref === 2) return { error: 'ref 不存在或已过期（页面变了）——重新 api.browser.snapshot' }
      return { x: 50, y: 60 }
    },
  }
  return { deps, opened, activated, closed, snapshotted, located }
}

/** 假 webview：记录注入的输入事件与插入的文字（定位已全部走主进程 CDP，页面 JS 不再注入） */
function fakeWv() {
  const events: unknown[] = []
  const texts: string[] = []
  const el = {
    isLoading: () => false,
    getWebContentsId: () => 424242,
    sendInputEvent: async (e: unknown) => {
      events.push(e)
    },
    insertText: async (t: string) => {
      texts.push(t)
    },
  }
  return { el: el as unknown as WebviewTag, events, texts }
}

/** 登记一枚假元素，测试结束随手摘掉（登记表是模块级的，别串到别的用例） */
async function withWv(tabId: string, el: WebviewTag, run: () => Promise<void>): Promise<void> {
  registerWebview(tabId, el)
  try {
    await run()
  } finally {
    registerWebview(tabId, null)
  }
}

const META: WebTabMeta = { url: 'https://x.com/a', loading: false, canBack: false, canFwd: false, error: null }

describe('makeBrowserOps：browser.* 的宿主实现（纯逻辑 + 假元素，Node 里可测）', () => {
  it('open 归一网址后交给宿主开签；空网址拒绝；没有元素时 note 说明还在挂载', async () => {
    const { deps, opened } = makeDeps(storeWith([], null))
    const ops = makeBrowserOps(deps, 'goal1')
    const r = await ops.open('example.com')
    expect(r).toEqual({ tabId: 'w:newkey', url: 'https://example.com', note: expect.any(String) })
    expect(opened).toEqual(['https://example.com'])
    await expect(ops.open('  ')).rejects.toThrow('要给出网址')
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

  it('snapshot 把主进程的元素清单原样带回（wcId 来自页签的 guest）', async () => {
    const { deps, snapshotted } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el } = fakeWv()
    await withWv('w:a', el, async () => {
      const r = await ops.snapshot(undefined)
      expect(r).toEqual({ elements: [{ ref: 1, role: 'button', name: '提交' }] })
    })
    expect(snapshotted.length).toBe(1)
    expect(snapshotted[0]).toBe(424242)
    // 主进程报错要变成可读的失败，而不是把 { error } 当成功交回去
    const broken = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    broken.deps.snapshot = async () => ({ error: '调试通道被占用' })
    await withWv('w:a', el, async () => {
      await expect(makeBrowserOps(broken.deps, 'goal1').snapshot('w:a')).rejects.toThrow('调试通道被占用')
    })
  })

  it('click 的 { ref } 目标走主进程定位（拿回坐标再注入 move→down→up）', async () => {
    const { deps, located } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el, events } = fakeWv()
    await withWv('w:a', el, async () => {
      const r = await ops.click(undefined, { ref: 1 })
      expect(r).toEqual({ ok: true, at: { x: 50, y: 60 } })
    })
    expect(located[0][1]).toEqual({ ref: 1 })
    expect(events).toEqual([
      { type: 'mouseMove', x: 50, y: 60 },
      { type: 'mouseDown', x: 50, y: 60, button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: 50, y: 60, button: 'left', clickCount: 1 },
    ])
  })

  it('click 的选择器目标同样走主进程定位；坐标目标不触发定位', async () => {
    const { deps, located } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el, events } = fakeWv()
    await withWv('w:a', el, async () => {
      await ops.click('w:a', '.btn')
      expect(located[0][1]).toEqual({ selector: '.btn' })
      await ops.click('w:a', { x: 10.4, y: 20.6 }, { button: 'right' })
    })
    expect(located.length).toBe(1)
    expect(events.filter((e) => (e as { type: string }).type === 'mouseDown')).toEqual([
      { type: 'mouseDown', x: 50, y: 60, button: 'left', clickCount: 1 },
      { type: 'mouseDown', x: 10, y: 21, button: 'right', clickCount: 1 },
    ])
  })

  it('过期 ref 的定位错误原样抛给模型（引导重新 snapshot）', async () => {
    const { deps } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el } = fakeWv()
    await withWv('w:a', el, async () => {
      await expect(ops.click(undefined, { ref: 2 })).rejects.toThrow('重新 api.browser.snapshot')
    })
  })

  it('drag 按步分段注入 move，down 在起点、up 在终点', async () => {
    const { deps } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el, events } = fakeWv()
    await withWv('w:a', el, async () => {
      const r = await ops.drag(undefined, { x: 0, y: 0 }, { x: 100, y: 50 }, { steps: 2 })
      expect(r).toEqual({ ok: true, from: { x: 0, y: 0 }, to: { x: 100, y: 50 } })
    })
    const types = events.map((e) => (e as { type: string }).type)
    expect(types[0]).toBe('mouseMove')
    expect(types[1]).toBe('mouseDown')
    expect(types[types.length - 1]).toBe('mouseUp')
    expect(events[2]).toEqual({ type: 'mouseMove', x: 50, y: 25 })
    expect(events[events.length - 1]).toEqual({ type: 'mouseUp', x: 100, y: 50, button: 'left', clickCount: 1 })
  })

  it('scroll 校验滚动量并原样传 delta；type 先点目标再插文字（中文照常）', async () => {
    const { deps, located } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el, events, texts } = fakeWv()
    await withWv('w:a', el, async () => {
      await expect(ops.scroll('w:a', {})).rejects.toThrow('要给出滚动量')
      await ops.scroll('w:a', { dy: 300.4 })
      expect(events[0]).toEqual({ type: 'mouseWheel', x: 0, y: 0, deltaX: 0, deltaY: 300 })
      const r = await ops.type('w:a', '你好世界', '.input')
      expect(r).toEqual({ ok: true, typed: 4 })
      expect(texts).toEqual(['你好世界'])
      expect(located[0][1]).toEqual({ selector: '.input' })
      // 先点了目标（move→down→up 三件套），再插文字
      expect(events.slice(1, 4).map((e) => (e as { type: string }).type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
    })
  })

  it('key 解析组合键（修饰键 + 单键），空格与裸键照给', async () => {
    const { deps } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el, events } = fakeWv()
    await withWv('w:a', el, async () => {
      await ops.key('w:a', 'Ctrl+A')
      await ops.key('w:a', 'Enter')
      await ops.key('w:a', 'Space')
      await expect(ops.key('w:a', 'Hyper+X')).rejects.toThrow('不认识的修饰键')
      await expect(ops.key('w:a', '  ')).rejects.toThrow('要给出键名')
    })
    expect(events.slice(0, 2)).toEqual([
      { type: 'keyDown', keyCode: 'A', modifiers: ['control'] },
      { type: 'keyUp', keyCode: 'A', modifiers: ['control'] },
    ])
    expect(events[2]).toEqual({ type: 'keyDown', keyCode: 'Enter', modifiers: [] })
    expect(events[4]).toEqual({ type: 'keyDown', keyCode: ' ', modifiers: [] })
  })

  it('指名不存在的页签、或焦点格没有网页时，报错并引导先 tabs()', async () => {
    const { deps } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    await expect(ops.click('w:ghost', '.x')).rejects.toThrow('没有这个网页页签')
    await expect(ops.capture('w:ghost')).rejects.toThrow('没有这个网页页签')
    await expect(ops.snapshot('w:ghost')).rejects.toThrow('没有这个网页页签')
    // 焦点格激活的是网页，但元素没挂上（刚重启回来）：元素级的错
    await expect(ops.capture(undefined)).rejects.toThrow('网页元素不在了')
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
})

// @vitest-environment happy-dom
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
  const pointed: Array<[number, { ref: number } | { selector: string }]> = []
  const domOps: Array<[number, number, string, string | undefined]> = []
  const readHtmls: number[] = []
  const logCalls: Array<[number, unknown]> = []
  const fetchCalls: Array<[number, unknown]> = []
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
    point: async (wcId, target) => {
      pointed.push([wcId, target])
      return { ok: true }
    },
    domOp: async (wcId, ref, op, arg) => {
      domOps.push([wcId, ref, op, arg])
      // ref=2 是「过期 ref」的哨兵
      if (ref === 2) return { error: 'ref 不存在或已过期（页面变了）——重新 api.browser.snapshot' }
      return { ok: true, result: op === 'fill' ? arg : op === 'attr' ? 'https://x.com/next' : undefined }
    },
    readHtml: async (wcId) => {
      readHtmls.push(wcId)
      return {
        html: '<html><head><title>测试页</title></head><body><h1>你好</h1><p>世界</p></body></html>',
        url: 'https://x.com/a',
        title: '测试页',
      }
    },
    logs: async (wcId, opts) => {
      logCalls.push([wcId, opts])
      return { lines: ['[n1] GET https://x.com/api → 200'], shown: 1, totalConsole: 0, totalNetwork: 1, latestSeq: 1, truncated: false }
    },
    logDetail: async (wcId, seq) => {
      logCalls.push([wcId, seq])
      return { detail: { kind: 'network', seq, method: 'GET', url: 'https://x.com/api', status: 200, type: 'XHR' } }
    },
    pageFetch: async (wcId, req) => {
      fetchCalls.push([wcId, req])
      return { status: 200, body: '{"ok":true}' }
    },
    record: async (wcId, action) => {
      logCalls.push([wcId, action])
      return action === 'start'
        ? { ok: true as const, action: 'start' as const, since: 0 }
        : { lines: [], shown: 0, totalConsole: 0, totalNetwork: 0, latestSeq: 0, truncated: false, action: 'stop' as const }
    },
  }
  return { deps, opened, activated, closed, snapshotted, pointed, domOps, readHtmls, logCalls, fetchCalls }
}

/** 假 webview：只有 browserOps 真正用到的方法（定位/读 DOM 都在主进程 CDP） */
function fakeWv() {
  const captured: string[] = []
  const el = {
    isLoading: () => false,
    getWebContentsId: () => 424242,
    capturePage: async () => {
      captured.push('shot')
      return { toDataURL: () => 'data:image/png;base64,AAAA' } as never
    },
  }
  return { el: el as unknown as WebviewTag, captured }
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

  it('snapshot 把主进程的元素清单原样带回；主进程报错变成可读的失败', async () => {
    const { deps, snapshotted } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el } = fakeWv()
    await withWv('w:a', el, async () => {
      const r = await ops.snapshot(undefined)
      expect(r).toEqual({ elements: [{ ref: 1, role: 'button', name: '提交' }] })
    })
    expect(snapshotted).toEqual([424242])
    const broken = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    broken.deps.snapshot = async () => ({ error: '调试通道被占用' })
    await withWv('w:a', el, async () => {
      await expect(makeBrowserOps(broken.deps, 'goal1').snapshot('w:a')).rejects.toThrow('调试通道被占用')
    })
  })

  it('point 归一目标（ref / 选择器）并透传给主进程；错误原样抛', async () => {
    const { deps, pointed } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el } = fakeWv()
    await withWv('w:a', el, async () => {
      await ops.point(undefined, { ref: 1 })
      await ops.point('w:a', '.btn')
      await expect(ops.point('w:a', '   ')).rejects.toThrow('目标要给 snapshot 清单里的 { ref } 或 CSS 选择器')
    })
    expect(pointed.map(([, t]) => t)).toEqual([{ ref: 1 }, { selector: '.btn' }])
    const broken = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    broken.deps.point = async () => ({ error: 'ref 不存在或已过期（页面变了）——重新 api.browser.snapshot' })
    await withWv('w:a', el, async () => {
      await expect(makeBrowserOps(broken.deps, 'goal1').point(undefined, { ref: 9 })).rejects.toThrow(
        '重新 api.browser.snapshot',
      )
    })
  })

  it('dom 校验 ref 与 op，参数透传，result 原样带回', async () => {
    const { deps, domOps } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el } = fakeWv()
    await withWv('w:a', el, async () => {
      const r = await ops.dom('w:a', 1, 'fill', '你好')
      expect(r).toEqual({ ok: true, result: '你好' })
      const r2 = await ops.dom(undefined, 1, 'attr', 'href')
      expect(r2).toEqual({ ok: true, result: 'https://x.com/next' })
      await expect(ops.dom('w:a', Number.NaN, 'click')).rejects.toThrow('ref 要给 browser.snapshot 清单里的编号数字')
      await expect(ops.dom('w:a', 1, '  ')).rejects.toThrow('要给出 dom 操作')
      await expect(ops.dom('w:a', 2, 'click')).rejects.toThrow('重新 api.browser.snapshot')
    })
    expect(domOps).toEqual([
      [424242, 1, 'fill', '你好'],
      [424242, 1, 'attr', 'href'],
      [424242, 2, 'click', undefined],
    ])
  })

  it('read 把主进程取回的 DOM HTML 走 webFetch 同一条管线（短的回全文）', async () => {
    const { deps, readHtmls } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    const { el } = fakeWv()
    await withWv('w:a', el, async () => {
      const r = (await ops.read(undefined)) as { ok: boolean; text: string; saved: boolean; title: string }
      expect(r.ok).toBe(true)
      expect(r.text).toContain('你好')
      expect(r.text).toContain('世界')
      expect(r.title).toBe('测试页')
      // 测试环境没有存储桥：落盘失败也要回全文，只是 note 里说明
      expect(r.saved).toBe(false)
    })
    expect(readHtmls).toEqual([424242])
    const broken = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    broken.deps.readHtml = async () => ({ error: '这一页签的网页已经不在了' })
    await withWv('w:a', el, async () => {
      await expect(makeBrowserOps(broken.deps, 'goal1').read('w:a')).rejects.toThrow('这一页签的网页已经不在了')
    })
  })

  it('指名不存在的页签、或焦点格没有网页时，报错并引导先 tabs()', async () => {
    const { deps } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const ops = makeBrowserOps(deps, 'goal1')
    await expect(ops.point('w:ghost', { ref: 1 })).rejects.toThrow('没有这个网页页签')
    await expect(ops.dom('w:ghost', 1, 'click')).rejects.toThrow('没有这个网页页签')
    await expect(ops.snapshot('w:ghost')).rejects.toThrow('没有这个网页页签')
    await expect(ops.read('w:ghost')).rejects.toThrow('没有这个网页页签')
    // 焦点格激活的是网页，但元素没挂上（刚重启回来）：元素级的错
    await expect(ops.capture(undefined)).rejects.toThrow('网页元素不在了')
    const ops2 = makeBrowserOps(makeDeps(storeWith([], null)).deps, 'goal1')
    await expect(ops2.read(undefined)).rejects.toThrow('焦点格里没有正看着的网页页签')
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

  it('logs / logDetail / record：tabId 必给（不吃焦点默认），seq 必须是数字，透传到宿主', async () => {
    const { deps, logCalls } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const el = fakeWv().el
    const ops = makeBrowserOps(deps, 'goal1')
    await withWv('w:a', el, async () => {
      await ops.logs('w:a', { level: 'all' })
      await ops.logDetail('w:a', 7)
      await ops.record('w:a', 'start')
      await ops.record('w:a', 'stop', { level: 'all' })
      expect(logCalls).toEqual([
        [424242, { level: 'all' }],
        [424242, 7],
        [424242, 'start'],
        [424242, 'stop'],
      ])
      // tabId 缺失：新组不吃「焦点格正看着的」这种隐式状态
      await expect(ops.logs('')).rejects.toThrow('必须显式给 tabId')
      await expect(ops.fetch(undefined as unknown as string, 'https://x.com/api')).rejects.toThrow('必须显式给 tabId')
      await expect(ops.logDetail('w:a', Number.NaN)).rejects.toThrow('条目号数字')
      await expect(ops.record('w:a', 'pause' as never)).rejects.toThrow('start')
    })
  })

  it('fetch：网址与 {reqId} 两种寻址都透传；空目标拒绝；宿主报错原样抛', async () => {
    const { deps, fetchCalls } = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
    const el = fakeWv().el
    const ops = makeBrowserOps(deps, 'goal1')
    await withWv('w:a', el, async () => {
      await ops.fetch('w:a', 'https://x.com/api', { method: 'POST', body: '{"a":1}' })
      await ops.fetch('w:a', { reqId: 12 })
      expect(fetchCalls).toEqual([
        [424242, { url: 'https://x.com/api', method: 'POST', body: '{"a":1}' }],
        [424242, { reqId: 12 }],
      ])
      await expect(ops.fetch('w:a', '不是网址')).rejects.toThrow('http(s) 网址')
      await expect(ops.fetch('w:a', {} as unknown as { reqId: number })).rejects.toThrow('http(s) 网址')
      const broken = makeDeps(storeWith([webTab('a', 'https://x.com')], 'w:a'))
      broken.deps.pageFetch = async () => ({ error: '页面里请求失败：CSP' })
      await withWv('w:a', el, async () => {
        await expect(makeBrowserOps(broken.deps, 'goal1').fetch('w:a', 'https://x.com/api')).rejects.toThrow('CSP')
      })
    })
  })
})

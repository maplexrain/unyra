import type { WebviewTag } from 'electron'
import type { BrowserOps, BrowserTabInfo } from '../../agent/sandbox/types'
import type {
  WebLogDetailResult,
  WebLogsResult,
  WebPageFetchReq,
  WebPageFetchResult,
  WebRecordResult,
  WebSnapshotElement,
} from '../../../shared/ipc'
import type { LearnStore, TabRef, WebTabMeta } from '../types'
import { findTab, focusedGroup, groupIdOfTab } from '../groups'
import { normalizeWebInput } from '../webUrl'
import { webviewOf } from './webviewRegistry'
import { saveScreenshot } from '../screenshots'
import { livePageForAgent } from '../webDocs'

/**
 * browser.* 的宿主实现（沙箱里 api.browser.* 的真身，见 agent/sandbox/types 的 BrowserOps）。
 *
 * 这一层是「看 = 快照/阅读/截图、动手 = 受控 DOM 操作、指给用户看 = point」：
 * - 看页面有三条：snapshot（Accessibility 树 → 带 ref 的元素清单，纯文本、省）、read（live DOM
 *   的 outerHTML → webFetch 同一条 markdown 管线）、capture（截图）。**没有任意执行页面 JS 的
 *   口子**——read / eval 试过一轮，返回结果不可控，已从沙箱面撤掉。
 * - 动手是 browser.dom：对 snapshot 的 ref 做受控操作——主进程 CDP 上跑**固定函数 + 值参数**
 *   （DOM.resolveNode → Runtime.callFunctionOn），agent 传不进一段自由 JS。
 * - 定位（ref / selector → DOM 节点）也全在主进程 CDP，渲染层不注入任何页面 JS。
 *
 * 页签模型（docArea）与活信息（webMeta）是学习工作区组件的状态，动作也是组件闭包——
 * 由 LearnWorkspace 每轮渲染装配一份 BrowserDeps 交给 useAgent，回合内在这里拼成
 * BrowserOps（goalId 是回合内的，截图落进那个目标的资源库）。
 */
export interface BrowserDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  /** 开一个网页页签（url 在里面归一），回页签 id */
  openWebTab: (url: string) => string
  activateTab: (tabId: string) => void
  closeTab: (groupId: string, tabId: string, mode: 'self', opts?: { confirm?: boolean }) => void
  /** web 页签的活信息（真标题/加载态）；每次渲染都是最新的一份 */
  webMeta: Record<string, WebTabMeta>
  /** 页面快照（主进程：Accessibility 树 → 带 ref 的可交互元素清单，见 shared/axTree） */
  snapshot: (wcId: number) => Promise<{ elements: WebSnapshotElement[]; truncated?: boolean } | { error: string }>
  /** 页面滚到目标元素并高亮突出（主进程 CDP：scrollIntoView + 脉冲描边） */
  point: (wcId: number, target: { ref: number } | { selector: string }) => Promise<{ ok: true } | { error: string }>
  /** 对 snapshot 的 ref 执行受控 DOM 操作（主进程 CDP：固定函数 + 值参数） */
  domOp: (wcId: number, ref: number, op: string, arg?: string) => Promise<{ ok: true; result?: unknown } | { error: string }>
  /** 拿当前页的整份 DOM HTML（主进程 CDP：DOM.getOuterHTML），渲染层走 webFetch 同一条管线 */
  readHtml: (wcId: number) => Promise<{ html: string; url: string; title: string } | { error: string }>
  /** 页签日志清单（折叠去重，缓冲在主进程，见 shared/webLogs） */
  logs: (wcId: number, opts: Record<string, unknown>) => Promise<WebLogsResult>
  /** 单条日志详情（完整头/栈/响应体，截断） */
  logDetail: (wcId: number, seq: number, opts: Record<string, unknown>) => Promise<WebLogDetailResult>
  /** 页面上下文直发 HTTP（继承页签登录态；{reqId} 重放捕获的请求） */
  pageFetch: (wcId: number, req: WebPageFetchReq) => Promise<WebPageFetchResult>
  /** 日志录制（start 钉水位 / stop 回区间清单） */
  record: (wcId: number, action: 'start' | 'stop', opts: Record<string, unknown>) => Promise<WebRecordResult>
}

type WebTabRef = Extract<TabRef, { kind: 'web' }>

/** 动手/看之前先等页面安静：isLoading 轮询（上限 8s，超时不报错，拿到什么算什么） */
async function settle(wv: WebviewTag, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (!wv.isLoading()) return
    } catch {
      return
    }
    await new Promise((r) => setTimeout(r, 120))
  }
}

/** 页面级调用有兜底超时（默认 12s，fetch 类可放宽）：页面卡死不该把整轮沙箱拖到空闲超时 */
function withTimeout<T>(p: Promise<T>, what: string, ms = 12_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what + '超时（页面可能没有响应）')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(t)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export function makeBrowserOps(deps: BrowserDeps, goalId: string): BrowserOps {
  const titleOf = (tabId: string, ref: WebTabRef): string =>
    deps.webMeta[tabId]?.title ?? (ref.url ? hostOf(ref.url) : '（起始页）')

  /** 指名要操作的页签：给了 tabId 就查；没给就取焦点格正看着的那个（必须是网页） */
  const resolveTab = (tabId?: string): { tabId: string; ref: WebTabRef } => {
    const s = deps.getLatest()
    if (tabId) {
      const tab = findTab(s.docArea, tabId)
      if (!tab || tab.ref.kind !== 'web') {
        throw new Error('没有这个网页页签：' + tabId + '。先 api.browser.tabs() 看一眼存活的页签。')
      }
      return { tabId, ref: tab.ref }
    }
    const group = focusedGroup(s.docArea)
    const tab = group?.tabs.find((t) => t.id === group.active)
    if (!tab || tab.ref.kind !== 'web') {
      throw new Error('焦点格里没有正看着的网页页签。先 api.browser.tabs() 列出存活的页签，再带 tabId 调用。')
    }
    return { tabId: tab.id, ref: tab.ref }
  }

  const element = (tabId: string): WebviewTag => {
    const wv = webviewOf(tabId)
    if (!wv) throw new Error('这一页签的网页元素不在了（可能刚开还没挂上，或已被关掉）：' + tabId)
    return wv
  }

  const wcIdOf = (wv: WebviewTag): number => {
    try {
      return wv.getWebContentsId()
    } catch {
      throw new Error('网页还没挂上（刚开的那一拍）——稍等再试')
    }
  }

  /**
   * 日志/直发这组新 api 的页签解析：**必须显式给 tabId**。日志与请求都跟着页签走，
   * 「焦点格正看着的那个」是隐式状态——这组不吃它，调错页签的代价太贵。
   */
  const resolveTabStrict = (tabId: unknown, what: string): { tabId: string; ref: WebTabRef } => {
    if (typeof tabId !== 'string' || !tabId.trim()) {
      throw new Error(what + ' 必须显式给 tabId（api.browser.tabs() 里查）——日志与请求都跟着页签走，不吃焦点默认')
    }
    return resolveTab(tabId)
  }

  return {
    async open(url) {
      const target = normalizeWebInput(url)
      if (!target) throw new Error('要给出网址：api.browser.open("https://…")')
      const tabId = deps.openWebTab(target)
      const wv = webviewOf(tabId)
      if (wv) await settle(wv)
      return {
        tabId,
        url: target,
        ...(wv ? {} : { note: '页签已开，网页元素还在挂载——马上再操作也能拿到（动手前会等它加载完）' }),
      }
    },
    tabs() {
      const s = deps.getLatest()
      const out: BrowserTabInfo[] = []
      for (const g of s.docArea.groups) {
        for (const t of g.tabs) {
          if (t.ref.kind !== 'web') continue
          out.push({
            tabId: t.id,
            url: t.ref.url,
            title: titleOf(t.id, t.ref),
            active: g.active === t.id,
            group: g.id,
          })
        }
      }
      return out
    },
    activate(tabId) {
      if (!groupIdOfTab(deps.getLatest().docArea, tabId)) {
        throw new Error('没有这个网页页签：' + tabId + '。先 api.browser.tabs() 看一眼存活的页签。')
      }
      deps.activateTab(tabId)
      return { ok: true }
    },
    close(tabId) {
      const group = groupIdOfTab(deps.getLatest().docArea, tabId)
      if (!group) {
        throw new Error('没有这个网页页签：' + tabId + '。先 api.browser.tabs() 看一眼存活的页签。')
      }
      deps.closeTab(group, tabId, 'self', { confirm: false })
      return { ok: true }
    },
    async snapshot(tabId) {
      const { tabId: id } = resolveTab(tabId)
      const wv = element(id)
      const r = await deps.snapshot(wcIdOf(wv))
      if ('error' in r) throw new Error(r.error)
      return { elements: r.elements, ...(r.truncated ? { truncated: r.truncated } : {}) }
    },
    async point(tabId, target) {
      const { tabId: id } = resolveTab(tabId)
      const wv = element(id)
      await settle(wv)
      const t: { ref: number } | { selector: string } =
        typeof target === 'string' ? { selector: target.trim() } : { ref: target.ref }
      if ('selector' in t && !t.selector) throw new Error('目标要给 snapshot 清单里的 { ref } 或 CSS 选择器')
      const r = await withTimeout(deps.point(wcIdOf(wv), t), '定位元素')
      if ('error' in r) throw new Error(r.error)
      return { ok: true }
    },
    async dom(tabId, ref, op, arg) {
      const { tabId: id } = resolveTab(tabId)
      const wv = element(id)
      if (typeof ref !== 'number' || !Number.isFinite(ref)) {
        throw new Error('ref 要给 browser.snapshot 清单里的编号数字')
      }
      if (typeof op !== 'string' || !op.trim()) {
        throw new Error('要给出 dom 操作：click / fill / focus / submit / text / attr')
      }
      await settle(wv)
      const r = await withTimeout(deps.domOp(wcIdOf(wv), ref, op.trim(), arg), 'dom.' + op.trim())
      if ('error' in r) throw new Error(r.error)
      return r
    },
    async read(tabId) {
      const { tabId: id, ref } = resolveTab(tabId)
      const wv = element(id)
      const raw = await withTimeout(deps.readHtml(wcIdOf(wv)), '读取页面')
      if ('error' in raw) throw new Error(raw.error)
      // 与 web.webFetch 同一条管线：转换、长文落盘、大纲树都在 webDocs（uuid 互通，web.read 接着读）
      return livePageForAgent(raw.html, raw.url || ref.url)
    },
    async capture(tabId) {
      const { tabId: id, ref } = resolveTab(tabId)
      const wv = element(id)
      const image = await withTimeout(wv.capturePage(), '截图')
      const saved = await saveScreenshot(deps.getLatest, deps.set, goalId, image.toDataURL(), '网页截图')
      if (!saved.ok) return { ok: false as const, error: saved.error }
      return {
        ok: true as const,
        note: '截图已存进资源库（res.list 里能看到），并附在你的下一步里。页面：' + titleOf(id, ref),
        images: [saved.image],
      }
    },
    async logs(tabId, opts) {
      const { tabId: id } = resolveTabStrict(tabId, 'browser.logs')
      const wv = element(id)
      const r = await withTimeout(deps.logs(wcIdOf(wv), (opts ?? {}) as Record<string, unknown>), '读取日志')
      if ('error' in r) throw new Error(r.error)
      return r
    },
    async logDetail(tabId, seq, opts) {
      const { tabId: id } = resolveTabStrict(tabId, 'browser.logDetail')
      const wv = element(id)
      if (typeof seq !== 'number' || !Number.isFinite(seq)) {
        throw new Error('seq 要给清单行里的条目号数字（[c#] / [n#]）')
      }
      const r = await withTimeout(deps.logDetail(wcIdOf(wv), seq, (opts ?? {}) as Record<string, unknown>), '读取日志详情')
      if ('error' in r) throw new Error(r.error)
      return r.detail
    },
    async fetch(tabId, target, opts) {
      const { tabId: id } = resolveTabStrict(tabId, 'browser.fetch')
      const wv = element(id)
      const o = (opts ?? {}) as Record<string, unknown>
      const req: WebPageFetchReq = {}
      if (typeof target === 'string' && target.trim()) {
        if (!/^https?:\/\//i.test(target.trim())) {
          throw new Error('目标要给 http(s) 网址，或 { reqId }（browser.logs 网络清单里的条目号，重放页面发过的请求）')
        }
        req.url = target.trim()
      } else if (target && typeof target === 'object' && typeof (target as { reqId?: unknown }).reqId === 'number') {
        req.reqId = (target as { reqId: number }).reqId
      } else {
        throw new Error('目标要给 http(s) 网址，或 { reqId }（browser.logs 网络清单里的条目号，重放页面发过的请求）')
      }
      if (typeof o.method === 'string' && o.method.trim()) req.method = o.method.trim()
      if (o.headers && typeof o.headers === 'object') req.headers = o.headers as Record<string, string>
      if (typeof o.body === 'string') req.body = o.body
      if (typeof o.maxBody === 'number') req.maxBody = o.maxBody
      if (typeof o.timeoutMs === 'number') req.timeoutMs = o.timeoutMs
      const r = await withTimeout(deps.pageFetch(wcIdOf(wv), req), '直发请求', clampFetchTimeoutMs(o))
      if ('error' in r) throw new Error(r.error)
      return r
    },
    async record(tabId, action, opts) {
      const { tabId: id } = resolveTabStrict(tabId, 'browser.record')
      const wv = element(id)
      if (action !== 'start' && action !== 'stop') {
        throw new Error('record 的动作只有 "start"（起录） / "stop"（停并回这段的清单）')
      }
      const r =
        action === 'start'
          ? await deps.record(wcIdOf(wv), 'start', {})
          : await withTimeout(deps.record(wcIdOf(wv), 'stop', (opts ?? {}) as Record<string, unknown>), '结束录制')
      if ('error' in r) throw new Error(r.error)
      return r
    },
  }
}

/** 直发请求的兜底上限跟页内超时走（主进程侧已夹到 60s） */
function clampFetchTimeoutMs(o: Record<string, unknown>): number {
  return (typeof o.timeoutMs === 'number' && Number.isFinite(o.timeoutMs) ? o.timeoutMs : 15_000) + 15_000
}

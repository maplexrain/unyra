import type { WebviewTag } from 'electron'
import type { BrowserOps, BrowserTabInfo } from '../../agent/sandbox/types'
import type { LearnStore, TabRef, WebTabMeta } from '../types'
import { findTab, focusedGroup, groupIdOfTab } from '../groups'
import { normalizeWebInput } from '../webUrl'
import { webviewOf } from './webviewRegistry'
import { saveScreenshot } from '../screenshots'

/**
 * browser.* 的宿主实现（沙箱里 api.browser.* 的真身，见 agent/sandbox/types 的 BrowserOps）。
 *
 * 这些 api 操作的是**界面上开着的网页页签**：页签模型（docArea）与活信息（webMeta）
 * 都是学习工作区组件的状态，动作（openWebTab / activateTab / closeTab）也是组件闭包——
 * 所以由 LearnWorkspace 每轮渲染装配一份 BrowserDeps 交给 useAgent，回合内在这里
 * 拼成 BrowserOps（goalId 是回合内的，截图落进那个目标的资源库）。
 *
 * webview 元素本身走模块级登记表（见 ./webviewRegistry）：WebPage 挂载时登记、
 * 卸载时摘除，这里现取现用。
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
}

type WebTabRef = Extract<TabRef, { kind: 'web' }>

/** 读正文/跑 JS 前先等页面安静：isLoading 轮询（上限 8s，超时不报错，拿到什么算什么） */
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

/** 页面级调用有 12s 兜底：页面卡死不该把整轮沙箱拖到空闲超时 */
function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what + '超时（页面可能没有响应）')), 12_000)
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

/** 页面里跑的正文提取：article / main 优先，退回整页 innerText */
const READ_SNIPPET =
  '(() => { const pick = document.querySelector(\'article, main, [role="main"]\') || document.body; ' +
  "const text = ((pick && pick.innerText) || document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim(); " +
  'return { title: document.title, url: location.href, text } })()'

/** 读正文的截断线：给模型留出其余结果的余地（execute 层 3.2 万字符的总闸在后头） */
const MAX_READ_CHARS = 18_000

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
        ...(wv ? {} : { note: '页签已开，网页元素还在挂载——马上再 read/eval 也能拿到（会等它加载完）' }),
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
    async read(tabId) {
      const { tabId: id, ref } = resolveTab(tabId)
      const wv = element(id)
      await settle(wv)
      const r = (await withTimeout(wv.executeJavaScript(READ_SNIPPET, false), '读取页面')) as {
        title?: string
        url?: string
        text?: string
      }
      const full = r?.text ?? ''
      return {
        tabId: id,
        url: r?.url || ref.url,
        title: r?.title || titleOf(id, ref),
        text: full.slice(0, MAX_READ_CHARS),
        ...(full.length > MAX_READ_CHARS ? { truncated: true } : {}),
      }
    },
    async eval(tabId, code) {
      if (typeof code !== 'string' || !code.trim()) {
        throw new Error('要给一段 JS 源码字符串：api.browser.eval(tabId?, "document.title")')
      }
      const { tabId: id } = resolveTab(tabId)
      const wv = element(id)
      const value = await withTimeout(wv.executeJavaScript(code, false), '页面执行')
      return value === undefined ? { ok: true, note: '（这段 JS 没有返回值）' } : value
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
  }
}

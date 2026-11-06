import type { BrowserClickResult, BrowserFillResult, BrowserOps, BrowserTabInfo, BrowserTarget, BrowserTypeOpts, BrowserTypeResult } from '../../agent/sandbox/types'
import type { LearnStore, TabRef, WebTabMeta } from '../types'
import { findTab, focusedGroup, groupIdOfTab } from '../groups'
import { normalizeWebInput } from '../webUrl'
import { buildRuntimeExecScript } from './browserRuntimeScript'
import { webviewOf } from './webviewRegistry'

/**
 * browser.* 的宿主实现（沙箱里 api.browser.* 的真身，见 agent/sandbox/types 的 BrowserOps）。
 * 涵盖网页页签生命周期（open / tabs / activate / close）与基础读写（index / text / inspect / click / fill / press / scroll）。
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
  /** 在指定网页访客环境（guest）中执行 JavaScript 并获取返回值 */
  execJs?: (tabId: string, script: string) => Promise<unknown>
}

type WebTabRef = Extract<TabRef, { kind: 'web' }>

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export function makeBrowserOps(deps: BrowserDeps, _goalId?: string): BrowserOps {
  const titleOf = (tabId: string, ref: WebTabRef): string =>
    deps.webMeta[tabId]?.title ?? (ref.url ? hostOf(ref.url) : '（起始页）')

  /** 解析目标页签：给 tabId 就查；不给就取焦点格正在看着的那个网页页签 */
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
      throw new Error('当前焦点格中没有正在浏览的网页页签。先 api.browser.tabs() 查看存活页签，或显式传入 tabId。')
    }
    return { tabId: tab.id, ref: tab.ref }
  }

  /** 在页面访客进程中执行代码并拿到返回值 */
  const executeInPage = async <T>(tabId: string | undefined, fnCall: string): Promise<T> => {
    const { tabId: resolvedId } = resolveTab(tabId)
    const script = buildRuntimeExecScript(fnCall)

    try {
      if (deps.execJs) {
        return (await deps.execJs(resolvedId, script)) as T
      }

      const wv = webviewOf(resolvedId)
      if (wv && typeof wv.executeJavaScript === 'function') {
        return (await wv.executeJavaScript(script)) as T
      }

      throw new Error('未能连接到网页执行环境（网页页签未挂载或已销毁）：' + resolvedId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err))
      throw new Error(msg)
    }
  }

  return {
    async open(url) {
      const target = normalizeWebInput(url)
      if (!target) throw new Error('要给出网址：api.browser.open("https://…")')
      const tabId = deps.openWebTab(target)
      return {
        tabId,
        url: target,
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
      return { tabs: out }
    },
    activate(tabId) {
      if (!groupIdOfTab(deps.getLatest().docArea, tabId)) {
        throw new Error('没有这个网页页签：' + tabId + '。先 api.browser.tabs() 看一眼存活的页签。')
      }
      deps.activateTab(tabId)
      return { ok: true }
    },
    close(tabId) {
      const ids = Array.isArray(tabId) ? tabId : [tabId]
      for (const id of ids) {
        const group = groupIdOfTab(deps.getLatest().docArea, id)
        if (!group) {
          throw new Error('没有这个网页页签：' + id + '。先 api.browser.tabs() 看一眼存活的页签。')
        }
        deps.closeTab(group, id, 'self', { confirm: false })
      }
      return { ok: true }
    },
    async index(tabId, opts) {
      const focusTarget = opts?.focus ?? null
      return executeInPage(tabId, `window.__agentIndex(${JSON.stringify(focusTarget)})`)
    },
    async text(tabId, target: BrowserTarget, opts) {
      return executeInPage(tabId, `window.__agentText(${JSON.stringify(target)}, ${JSON.stringify(opts ?? {})})`)
    },
    async inspect(tabId, target: BrowserTarget) {
      return executeInPage(tabId, `window.__agentInspect(${JSON.stringify(target)})`)
    },
    async click(tabId, target: BrowserTarget, opts) {
      const r = await executeInPage<BrowserClickResult>(
        tabId,
        `window.__agentClick(${JSON.stringify(target)}, ${JSON.stringify(opts ?? {})})`,
      )
      if (opts?.waitAfterMs && opts.waitAfterMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, opts.waitAfterMs))
      }
      return r
    },
    async fill(tabId, target: BrowserTarget, text: string, opts) {
      return executeInPage<BrowserFillResult>(
        tabId,
        `window.__agentFill(${JSON.stringify(target)}, ${JSON.stringify(text)}, ${JSON.stringify(opts ?? {})})`,
      )
    },
    async type(tabId, target: BrowserTarget, text: string, opts?: BrowserTypeOpts) {
      return executeInPage<BrowserTypeResult>(
        tabId,
        `window.__agentType(${JSON.stringify(target)}, ${JSON.stringify(text)}, ${JSON.stringify(opts ?? {})})`,
      )
    },
    async press(tabId, key: string, target?: BrowserTarget) {
      return executeInPage(
        tabId,
        `window.__agentPress(${JSON.stringify(key)}, ${JSON.stringify(target ?? null)})`,
      )
    },
    async scroll(tabId, opts) {
      return executeInPage(tabId, `window.__agentScroll(${JSON.stringify(opts ?? {})})`)
    },
  }
}

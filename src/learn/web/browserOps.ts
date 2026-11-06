import type { BrowserOps, BrowserTabInfo } from '../../agent/sandbox/types'
import type { LearnStore, TabRef, WebTabMeta } from '../types'
import { groupIdOfTab } from '../groups'
import { normalizeWebInput } from '../webUrl'

/**
 * browser.* 的宿主实现（沙箱里 api.browser.* 的真身，见 agent/sandbox/types 的 BrowserOps）。
 * 专注于网页页签生命周期（open / tabs / activate / close）。
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
  }
}

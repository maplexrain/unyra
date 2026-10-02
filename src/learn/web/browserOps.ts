import type { KeyboardInputEvent, MouseInputEvent, MouseWheelInputEvent, WebviewTag } from 'electron'
import type { BrowserOps, BrowserTabInfo, BrowserTarget } from '../../agent/sandbox/types'
import type { LearnStore, TabRef, WebTabMeta } from '../types'
import { findTab, focusedGroup, groupIdOfTab } from '../groups'
import { normalizeWebInput } from '../webUrl'
import { webviewOf } from './webviewRegistry'
import { saveScreenshot } from '../screenshots'

/**
 * browser.* 的宿主实现（沙箱里 api.browser.* 的真身，见 agent/sandbox/types 的 BrowserOps）。
 *
 * 这一层是「看 = 截图、动手 = 真输入注入」：
 * - 看页面只有 capture（capturePage → 资源库 → images 通道）；**没有读页面文字与执行
 *   页面 JS 的口子**——那两条（read / eval）试过一轮，返回结果不可控，已从沙箱面撤掉。
 *   唯一还在页面里跑 JS 的地方是**内部**的坐标测量（selector → 中心点，见 MEASURE_SNIPPET），
 *   返回值只有 { x, y }，可控。
 * - 动手走 webview 元素的 sendInputEvent / insertText（等价 CDP Input 域）：页面收到的是
 *   **可信事件**（isTrusted），导航、右键、双击、拖拽、滚轮都走真实行为链路。
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
}

type WebTabRef = Extract<TabRef, { kind: 'web' }>

/** 动手前先等页面安静：isLoading 轮询（上限 8s，超时不报错，拿到什么算什么） */
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

/** 输入注入有 12s 兜底：页面卡死不该把整轮沙箱拖到空闲超时 */
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * selector → 中心坐标：滚到可视区再量。这是**内部**使用页面 JS 的唯一一处，
 * 返回值钉死为 { x, y }（agent 面上没有 eval）。
 */
const MEASURE_SNIPPET = (sel: string): string => {
  const q = JSON.stringify(sel)
  return (
    '(() => { const el = document.querySelector(' + q + '); if (!el) return null; ' +
    "el.scrollIntoView({ block: 'center', inline: 'nearest' }); " +
    'const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()'
  )
}

/** 目标解析：选择器 → 等页面安静、量中心；坐标 → 取整原样 */
async function pointOf(wv: WebviewTag, target: BrowserTarget): Promise<{ x: number; y: number }> {
  if (typeof target === 'string') {
    const sel = target.trim()
    if (!sel) throw new Error('目标要给 CSS 选择器字符串或 { x, y } 坐标')
    await settle(wv)
    const p = (await withTimeout(wv.executeJavaScript(MEASURE_SNIPPET(sel), false), '定位元素')) as {
      x?: number
      y?: number
    } | null
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') {
      throw new Error(
        '页面上找不到这个选择器：' + sel + '（跨源 iframe 里的元素定位不到——先截图再改用坐标）',
      )
    }
    return { x: Math.round(p.x), y: Math.round(p.y) }
  }
  if (typeof target !== 'object' || typeof target.x !== 'number' || typeof target.y !== 'number') {
    throw new Error('坐标目标要给 { x, y }（网页视口内的 CSS 像素）')
  }
  return { x: Math.round(target.x), y: Math.round(target.y) }
}

/** 键名按 KeyboardEvent.key；组合键只认修饰键 + 单键（'Ctrl+A'、'Shift+Tab'） */
const KEY_MODS: Record<string, 'alt' | 'control' | 'meta' | 'shift'> = {
  ctrl: 'control',
  control: 'control',
  shift: 'shift',
  alt: 'alt',
  meta: 'meta',
  cmd: 'meta',
}

function parseKeys(raw: string): { key: string; modifiers: string[] } {
  const parts = raw
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) throw new Error('要给出键名：api.browser.key("Enter")、api.browser.key("Ctrl+A")')
  const base = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1).map((s) => {
    const m = KEY_MODS[s.toLowerCase()]
    if (!m) throw new Error('不认识的修饰键：' + s + '（只认 Ctrl / Shift / Alt / Meta）')
    return m
  })
  // 空格的 KeyboardEvent.key 是空格字符，其余原样给（'Enter'、'Escape'、'a'）
  return { key: base.toLowerCase() === 'space' ? ' ' : base, modifiers }
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

  /** 一次完整的点击（move → down → up）；holdMs 的长按由 click 自己拆开 */
  const clickAt = async (wv: WebviewTag, x: number, y: number, button = 'left', clickCount = 1): Promise<void> => {
    await wv.sendInputEvent({ type: 'mouseMove', x, y } as MouseInputEvent)
    await wv.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount } as MouseInputEvent)
    await wv.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount } as MouseInputEvent)
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
    async click(tabId, target, opts = {}) {
      const { tabId: id } = resolveTab(tabId)
      const wv = element(id)
      const { x, y } = await pointOf(wv, target)
      const button = opts.button ?? 'left'
      const clickCount = opts.dbl ? 2 : 1
      await wv.sendInputEvent({ type: 'mouseMove', x, y } as MouseInputEvent)
      await wv.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount } as MouseInputEvent)
      if (opts.holdMs) await sleep(Math.max(0, Math.min(5000, Math.round(opts.holdMs))))
      await wv.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount } as MouseInputEvent)
      return { ok: true as const, at: { x, y } }
    },
    async drag(tabId, from, to, opts = {}) {
      const { tabId: id } = resolveTab(tabId)
      const wv = element(id)
      const a = await pointOf(wv, from)
      const b = await pointOf(wv, to)
      const steps = Math.max(2, Math.min(30, Math.round(opts.steps ?? 10)))
      await wv.sendInputEvent({ type: 'mouseMove', x: a.x, y: a.y } as MouseInputEvent)
      await wv.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 } as MouseInputEvent)
      for (let i = 1; i <= steps; i++) {
        await wv.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(a.x + ((b.x - a.x) * i) / steps),
          y: Math.round(a.y + ((b.y - a.y) * i) / steps),
        } as MouseInputEvent)
        await sleep(16)
      }
      await wv.sendInputEvent({ type: 'mouseUp', x: b.x, y: b.y, button: 'left', clickCount: 1 } as MouseInputEvent)
      return { ok: true as const, from: a, to: b }
    },
    async scroll(tabId, opts) {
      const { tabId: id } = resolveTab(tabId)
      const wv = element(id)
      const dx = Math.round(opts.dx ?? 0)
      const dy = Math.round(opts.dy ?? 0)
      if (!dx && !dy) throw new Error('要给出滚动量：api.browser.scroll({ dy: 600 })（dy 正数往下）')
      await wv.sendInputEvent({
        type: 'mouseWheel',
        x: Math.round(opts.x ?? 0),
        y: Math.round(opts.y ?? 0),
        deltaX: dx,
        deltaY: dy,
      } as MouseWheelInputEvent)
      return { ok: true }
    },
    async type(tabId, text, target) {
      if (typeof text !== 'string' || !text) {
        throw new Error('要给出要输入的文字：api.browser.type("要输入的内容", 目标?)')
      }
      const { tabId: id } = resolveTab(tabId)
      const wv = element(id)
      if (target) {
        const { x, y } = await pointOf(wv, target)
        await clickAt(wv, x, y)
      }
      await wv.insertText(text)
      return { ok: true as const, typed: [...text].length }
    },
    async key(tabId, keys) {
      if (typeof keys !== 'string' || !keys.trim()) {
        throw new Error('要给出键名：api.browser.key("Enter")、api.browser.key("Ctrl+A")')
      }
      const { tabId: id } = resolveTab(tabId)
      const wv = element(id)
      const { key, modifiers } = parseKeys(keys)
      await wv.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers } as KeyboardInputEvent)
      await wv.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers } as KeyboardInputEvent)
      return { ok: true }
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

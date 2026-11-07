/**
 * 页面快照与受控 DOM 操作（browser.snapshot / point / domOp / readHtml / text / scroll）：
 * Accessibility 树 → 带 ref 的元素清单；页面执行只有固定函数 + 值参数这一条口子。
 */
import { ipcMain, type Debugger } from 'electron'
import { axNodesToElements, type AxRawNode } from '../../../shared/axTree'
import type {
  WebDomOpResult,
  WebPointResult,
  WebReadHtmlResult,
  WebScrollReq,
  WebScrollResult,
  WebSnapshotResult,
  WebTextResult,
} from '../../../shared/ipc'
import { cdp, ensureDebugger, guestOf } from './sessionCdp'

/* ---------- 页面快照（browser.snapshot）：Accessibility 树 → 带 ref 的元素清单 ---------- */

/**
 * ref 台账：wcId →（ref → DOM 定位信息 + 展示用的 role/name）。
 * 每次快照整表覆盖；页签销毁随手摘掉。ref 是**每页签一份的易碎编号**——
 * 页面一变就可能失效，解析失败一律引导模型重新 snapshot，而不是猜。
 */
export const snapshotRefs = new Map<number, Map<number, { backendNodeId: number; role: string; name: string }>>()

/** ref / selector → backendNodeId（point 与 domOp 共用的定位层）。
 *  ref 走台账（快照那一刻钉下的 DOM 节点）；selector 现场从 DOM 树查。 */
async function backendOf(
  dbg: Debugger,
  wcId: number,
  target: { ref?: number; selector?: string },
): Promise<{ backendNodeId: number; label: string } | { error: string }> {
  if (typeof target?.ref === 'number') {
    const hit = snapshotRefs.get(wcId)?.get(target.ref)
    if (!hit) return { error: 'ref 不存在或已过期（页面变了）——重新 api.browser.snapshot' }
    return { backendNodeId: hit.backendNodeId, label: hit.name ? '（' + hit.role + '「' + hit.name + '」）' : '' }
  }
  if (typeof target?.selector === 'string' && target.selector.trim()) {
    const sel = target.selector.trim()
    const { root } = await cdp<{ root?: { nodeId?: number } }>(dbg, 'DOM.getDocument', { depth: 0 })
    if (!root?.nodeId) return { error: '拿不到页面的 DOM 树根（页面可能还没挂好）' }
    const { nodeId } = await cdp<{ nodeId?: number }>(dbg, 'DOM.querySelector', { nodeId: root.nodeId, selector: sel })
    if (!nodeId) {
      return { error: '页面上找不到这个选择器：' + sel + '（跨源 iframe 里的元素定位不到——先 snapshot 换 { ref }）' }
    }
    return { backendNodeId: nodeId, label: '' }
  }
  return { error: '定位目标要给 { ref } 或 { selector }' }
}

/** 受控 DOM 操作（browser.dom）的固定函数：op → 在元素上跑的 JS。
 *  这是 agent 面上**唯一**的页面执行口子，而且函数是死的、参数是值——没有任意 JS 的口子。 */
const DOM_OPS: Record<string, { fn: string; takesArg: boolean }> = {
  click: {
    fn: 'function () { this.scrollIntoView({ block: "center" }); this.click(); return true }',
    takesArg: false,
  },
  fill: {
    // React 受控输入框认的是 native setter + input 事件，直接赋值会被它自己的 state 抹掉
    fn: 'function (t) { const proto = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, "value").set; setter.call(this, String(t)); this.dispatchEvent(new Event("input", { bubbles: true })); this.dispatchEvent(new Event("change", { bubbles: true })); return this.value }',
    takesArg: true,
  },
  focus: {
    fn: 'function () { this.focus(); return document.activeElement === this }',
    takesArg: false,
  },
  submit: {
    fn: 'function () { const f = this.closest("form"); if (!f) return { error: "这个元素不在任何表单里——直接对提交按钮用 click，或对输入框 submit" }; f.requestSubmit(); return true }',
    takesArg: false,
  },
  text: {
    fn: 'function () { return ((this.innerText || this.textContent || "") + "").replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, 4000) }',
    takesArg: false,
  },
  attr: {
    fn: 'function (n) { const v = this.getAttribute(String(n)); if (v != null) return v.slice(0, 500); const p = this[String(n)]; return p == null || typeof p === "function" ? null : String(p).slice(0, 500) }',
    takesArg: true,
  },
  press: {
    // 键盘事件：React/站点自己的 keydown 监听认它（fill+submit 走不通的搜索框靠它）。
    // keyCode/which 构造器不收，老页面又认——构造后 defineProperty 补上。
    fn: 'function (k) { const name = String(k); const map = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 }; const keyCode = map[name] ?? (name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0); this.focus && this.focus(); for (const type of ["keydown", "keypress", "keyup"]) { const e = new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true }); Object.defineProperty(e, "keyCode", { get: () => keyCode }); Object.defineProperty(e, "which", { get: () => keyCode }); this.dispatchEvent(e); } return keyCode }',
    takesArg: true,
  },
}

/** browser.point 的高亮函数：滚到元素（锚点跳转），注入一圈短暂的脉冲描边 */
const POINT_FN =
  'function () {' +
  '  this.scrollIntoView({ block: "center", inline: "center" });' +
  '  if (!document.getElementById("moji-agent-point-style")) {' +
  '    const st = document.createElement("style");' +
  '    st.id = "moji-agent-point-style";' +
  '    st.textContent = "@keyframes mojiPointPulse{0%{box-shadow:0 0 0 0 rgba(74,143,212,.55)}100%{box-shadow:0 0 0 14px rgba(74,143,212,0)}}";' +
  '    document.head.appendChild(st);' +
  '  }' +
  '  const r = this.getBoundingClientRect();' +
  '  const hl = document.createElement("div");' +
  '  hl.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #4a8fd4;border-radius:6px;background:rgba(74,143,212,.12);animation:mojiPointPulse 1s ease-out 2;left:" + (r.left - 4) + "px;top:" + (r.top - 4) + "px;width:" + (r.width + 8) + "px;height:" + (r.height + 8) + "px;";' +
  '  document.body.appendChild(hl);' +
  '  setTimeout(() => hl.remove(), 2400);' +
  '  return true;' +
  '}'

/** browser.text 的固定函数：取渲染后的文本（innerText），按 maxChars 截——SPA 上不用截图读 */
const PAGE_TEXT_FN =
  'function (maxChars) {' +
  '  const t = ((this.innerText || this.textContent || "") + "").replace(/\\n{3,}/g, "\\n\\n").trim();' +
  '  return { text: t.slice(0, maxChars), chars: t.length };' +
  '}'

/** browser.scroll 的固定函数：滚页面（无限滚动信息流的引擎）；选择器是值参数，不是代码 */
const PAGE_SCROLL_FN =
  'function (arg) {' +
  '  if (arg.to === "top") { window.scrollTo({ top: 0, behavior: "instant" }); return { ok: true }; }' +
  '  if (arg.to === "bottom") { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); return { ok: true }; }' +
  '  if (typeof arg.to === "string" && arg.to) { const el = document.querySelector(arg.to); if (!el) return { error: "页面上找不到这个选择器：" + arg.to }; el.scrollIntoView({ block: "center", behavior: "instant" }); return { ok: true }; }' +
  '  if (typeof arg.by === "number") { window.scrollBy({ top: arg.by, behavior: "instant" }); return { ok: true }; }' +
  '  return { error: "要给 { by: 像素 } 或 { to: \\"top\\" | \\"bottom\\" | 选择器 }" };' +
  '}'

/** 滚动后的页面几何（scroll 两条路都要回） */
const PAGE_GEOMETRY_EXPR =
  '(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight, vh: window.innerHeight }))()'

/** 在某个 DOM 节点上执行我们的固定函数（参数只走值），回可序列化的小结果 */
async function callOnElement<T>(
  dbg: Debugger,
  backendNodeId: number,
  fn: string,
  args: Array<{ value: string }> = [],
): Promise<T> {
  const { object } = await cdp<{ object?: { objectId?: string } }>(dbg, 'DOM.resolveNode', { backendNodeId })
  if (!object?.objectId) throw new Error('这个元素的运行时对象拿不到了')
  const r = await cdp<{
    result?: { value?: unknown }
    exceptionDetails?: { exception?: { description?: string } }
  }>(dbg, 'Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn, arguments: args, returnByValue: true })
  if (r.exceptionDetails) {
    throw new Error(
      '页面里执行失败：' + (r.exceptionDetails.exception?.description ?? '未知异常').slice(0, 200),
    )
  }
  return (r.result?.value ?? true) as T
}

export function registerSnapshotIpc(): void {
  ipcMain.handle('web:snapshot', async (_e, wcId: number): Promise<WebSnapshotResult> => {
    const wc = guestOf(wcId)
    if (!wc) return { error: '这一页签的网页已经不在了' }
    try {
      const dbg = await ensureDebugger(wc)
      // 开了 Accessibility 域树才算出来；重复 enable 的报错吞掉即可
      await cdp(dbg, 'Accessibility.enable').catch(() => {})
      const { nodes } = await cdp<{ nodes?: AxRawNode[] }>(dbg, 'Accessibility.getFullAXTree', {})
      const { elements, truncated } = axNodesToElements(nodes)
      const refs = new Map<number, { backendNodeId: number; role: string; name: string }>()
      for (const el of elements) {
        if (el.backendNodeId !== undefined) {
          refs.set(el.ref, { backendNodeId: el.backendNodeId, role: el.role, name: el.name })
        }
      }
      snapshotRefs.set(wcId, refs)
      return {
        elements: elements.map(({ ref, role, name, value }) => ({
          ref,
          role,
          name,
          ...(value !== undefined ? { value } : {}),
        })),
        ...(truncated ? { truncated: true } : {}),
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : '页面快照失败' }
    }
  })

  // 页面滚到目标元素并高亮（browser.point）：锚点跳转 + 短暂脉冲描边
  ipcMain.handle(
    'web:point',
    async (
      _e,
      wcId: number,
      target: { ref?: number; selector?: string },
    ): Promise<WebPointResult> => {
      const wc = guestOf(wcId)
      if (!wc) return { error: '这一页签的网页已经不在了' }
      let label = ''
      try {
        const dbg = ensureDebugger(wc)
        await cdp(dbg, 'DOM.enable').catch(() => {})
        const hit = await backendOf(dbg, wcId, target)
        if ('error' in hit) return hit
        label = hit.label
        await callOnElement(dbg, hit.backendNodeId, POINT_FN)
        return { ok: true }
      } catch (err) {
        return { error: '定位失败' + label + '：' + (err instanceof Error ? err.message : '页面可能已经变了——重新 api.browser.snapshot') }
      }
    },
  )

  // 受控 DOM 操作（browser.dom）：固定函数 + 值参数，没有任意 JS 的口子
  ipcMain.handle(
    'web:domOp',
    async (_e, wcId: number, ref: number, op: string, arg?: string): Promise<WebDomOpResult> => {
      const spec = DOM_OPS[String(op ?? '')]
      if (!spec) {
        return { error: '不认识的 dom 操作：' + String(op) + '。可用：' + Object.keys(DOM_OPS).join(' / ') }
      }
      const hit = snapshotRefs.get(wcId)?.get(Number(ref))
      if (!hit) return { error: 'ref 不存在或已过期（页面变了）——重新 api.browser.snapshot' }
      const wc = guestOf(wcId)
      if (!wc) return { error: '这一页签的网页已经不在了' }
      try {
        const dbg = ensureDebugger(wc)
        await cdp(dbg, 'DOM.enable').catch(() => {})
        const result = await callOnElement<unknown>(
          dbg,
          hit.backendNodeId,
          spec.fn,
          spec.takesArg ? [{ value: String(arg ?? '') }] : [],
        )
        // 操作自己的「业务失败」（比如 submit 却不在表单里）也按错误交回去
        if (result && typeof result === 'object' && 'error' in (result as Record<string, unknown>)) {
          return { error: String((result as Record<string, unknown>).error) }
        }
        return { ok: true, ...(result !== undefined && result !== true ? { result } : {}) }
      } catch (err) {
        const label = hit.name ? '（' + hit.role + '「' + hit.name + '」）' : ''
        return {
          error:
            'dom.' +
            String(op) +
            ' 失败' +
            label +
            '：' +
            (err instanceof Error ? err.message : '页面可能已经变了——重新 api.browser.snapshot'),
        }
      }
    },
  )

  // 整页 HTML（browser.read 的第一步）：渲染层拿它走 webFetch 同一条 markdown 管线
  ipcMain.handle('web:readHtml', async (_e, wcId: number): Promise<WebReadHtmlResult> => {
    const wc = guestOf(wcId)
    if (!wc) return { error: '这一页签的网页已经不在了' }
    try {
      const dbg = ensureDebugger(wc)
      await cdp(dbg, 'DOM.enable').catch(() => {})
      const { root } = await cdp<{
        root?: { nodeId?: number; children?: Array<{ nodeId?: number; nodeName?: string }> }
      }>(dbg, 'DOM.getDocument', { depth: 1 })
      const htmlNode = root?.children?.find((c) => (c.nodeName ?? '').toUpperCase() === 'HTML')
      if (!htmlNode?.nodeId) return { error: '拿不到页面的 DOM（页面可能还没挂好）' }
      const { outerHTML } = await cdp<{ outerHTML?: string }>(dbg, 'DOM.getOuterHTML', { nodeId: htmlNode.nodeId })
      if (!outerHTML) return { error: '这一页拿不到 DOM 内容' }
      return { html: outerHTML, url: wc.getURL(), title: wc.getTitle() }
    } catch (err) {
      return { error: err instanceof Error ? err.message : '读取页面 DOM 失败' }
    }
  })

  // 区域文本（browser.text）：按 ref/selector 取渲染后的 innerText——SPA 上唯一的文本通道，
  // 提取管线对纯前端页面无能为力时（web:readHtml 那条），靠它而不是靠截图
  ipcMain.handle('web:text', async (_e, wcId: number, target: unknown): Promise<WebTextResult> => {
    const wc = guestOf(wcId)
    if (!wc) return { error: '这一页签的网页已经不在了' }
    const t = (target ?? {}) as { ref?: unknown; selector?: unknown; maxChars?: unknown }
    const maxChars =
      typeof t.maxChars === 'number' && Number.isFinite(t.maxChars)
        ? Math.min(Math.max(Math.floor(t.maxChars), 200), 20_000)
        : 4_000
    let label = ''
    try {
      const dbg = ensureDebugger(wc)
      await cdp(dbg, 'DOM.enable').catch(() => {})
      const hit = await backendOf(dbg, wcId, typeof t.ref === 'number' ? { ref: t.ref } : { selector: String(t.selector ?? '') })
      if ('error' in hit) return hit
      label = hit.label
      const r = await callOnElement<{ text?: string; chars?: number }>(dbg, hit.backendNodeId, PAGE_TEXT_FN, [
        { value: String(maxChars) },
      ])
      const text = r?.text ?? ''
      return {
        text,
        chars: r?.chars ?? text.length,
        ...(r?.chars !== undefined && r.chars > text.length ? { truncated: true } : {}),
      }
    } catch (err) {
      return {
        error: '取文本失败' + label + '：' + (err instanceof Error ? err.message : '页面可能已经变了——重新 api.browser.snapshot'),
      }
    }
  })

  // 滚页面（browser.scroll）：无限滚动信息流的引擎；ref 走台账，by/to 走 evaluate 固定函数
  ipcMain.handle('web:scroll', async (_e, wcId: number, raw: unknown): Promise<WebScrollResult> => {
    const wc = guestOf(wcId)
    if (!wc) return { error: '这一页签的网页已经不在了' }
    const req = (raw ?? {}) as WebScrollReq
    try {
      const dbg = ensureDebugger(wc)
      await cdp(dbg, 'DOM.enable').catch(() => {})
      if (typeof req.ref === 'number') {
        const hit = await backendOf(dbg, wcId, { ref: req.ref })
        if ('error' in hit) return hit
        await callOnElement(dbg, hit.backendNodeId, 'function () { this.scrollIntoView({ block: "center", behavior: "instant" }); return true }')
      } else {
        const arg = {
          by: typeof req.by === 'number' && Number.isFinite(req.by) ? Math.round(req.by) : undefined,
          to: typeof req.to === 'string' && req.to.trim() ? req.to.trim() : undefined,
        }
        if (arg.by === undefined && arg.to === undefined) {
          return { error: '要给 { by: 像素 } 或 { to: "top" | "bottom" | 选择器 }（或 snapshot 清单里的 { ref }）' }
        }
        const r = await cdp<{
          result?: { value?: { error?: string } }
          exceptionDetails?: { exception?: { description?: string } }
        }>(dbg, 'Runtime.evaluate', {
          expression: '(' + PAGE_SCROLL_FN + ')(' + JSON.stringify(arg) + ')',
          awaitPromise: true,
          returnByValue: true,
        })
        if (r.exceptionDetails) {
          return { error: '页面里滚动失败：' + (r.exceptionDetails.exception?.description ?? '未知异常').slice(0, 200) }
        }
        if (r.result?.value?.error) return { error: r.result.value.error }
      }
      const g = await cdp<{ result?: { value?: { y?: number; h?: number; vh?: number } } }>(
        dbg,
        'Runtime.evaluate',
        { expression: PAGE_GEOMETRY_EXPR, returnByValue: true },
      )
      const v = g.result?.value ?? {}
      const y = v.y ?? 0
      const h = v.h ?? 0
      const vh = v.vh ?? 0
      return {
        ok: true,
        scrollY: Math.round(y),
        scrollHeight: Math.round(h),
        viewport: Math.round(vh),
        atBottom: y + vh >= h - 2,
        atTop: y <= 2,
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : '滚动失败' }
    }
  })
}

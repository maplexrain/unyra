/**
 * 内置浏览器的会话与守门（网页页签，渲染层见 src/components/learn/web）。
 *
 * 网页页签用的是 <webview>：guest 是独立进程、默认全沙箱（无 node、无预载脚本），
 * 这里管它周围的三件事——
 * 1. 会话：persist:web 分区当「内置浏览器的 profile」，登录态跨页签、跨重启保留；
 *    UA 伪装成正常 Chrome（Electron 默认 UA 里的 Electron/… 会被 Google 登录这类站点直接拒掉）。
 * 2. 权限：定位、通知、摄像头一概拒绝；只放行剪贴板写入（网页的「复制」按钮）与网页全屏。
 * 3. 出口：guest 的 window.open / target=_blank / 中键新开，一律拦下来开成应用里的
 *    新 web 页签（渲染层 openWebTab 接住）；mailto 交给系统。应用级快捷键（Ctrl+Q/W/L）
 *    焦点在网页里时 DOM 层收不到，从 before-input-event 拦下来转发给主窗口。
 *
 * 下载不挂 will-download：Electron 默认弹系统「另存为」，够用。
 */
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, session, shell, webContents, type Debugger, type WebContents } from 'electron'
import { canOpenExternal } from '../link-core'
import { mainWindow } from './mainWindow'
import { t } from '../i18n'
import { axNodesToElements, type AxRawNode } from '../../shared/axTree'
import type {
  WebDomOpResult,
  WebLogDetailResult,
  WebLogsResult,
  WebPageFetchReq,
  WebPageFetchResult,
  WebPointResult,
  WebReadHtmlResult,
  WebRecordResult,
  WebScrollReq,
  WebScrollResult,
  WebSnapshotResult,
  WebTextResult,
  WebWaitReq,
  WebWaitResult,
} from '../../shared/ipc'
import {
  apiPathKey,
  capBodyText,
  capHeaders,
  flattenConsoleArgs,
  flattenStack,
  isTextualMime,
  newWebLogBuffer,
  pushConsoleLog,
  pushNetLog,
  queryWebLogs,
  replayHeadersOf,
  sanitizeLogsQuery,
  webLogDetail,
  WEB_LOG_DETAIL_BODY_MAX,
  type WebFetchSpec,
  type WebLogBuffer,
  type WebNetLogEntry,
} from '../../shared/webLogs'

/**
 * 内置浏览器的分区。渲染层 <webview partition> 与这里是**同一个字符串**（两处必须一致，
 * 各写一份、注释互指）：强制走独立分区，guest 永远摸不到应用自己的 Cookie。
 */
export const WEB_PARTITION = 'persist:web'

/**
 * 焦点在网页里也要能用的应用快捷键（guest 进程吃掉按键，宿主的 keydown 收不到，
 * 见 before-input-event 里的转发）：q = 聚焦导师，w = 关页签，l = 新建网页页签，
 * s = 保存，f / h = 查找 / 替换，e = 导出，F11 = 纯净阅读。
 * 复制 / 粘贴 / 全选那些组合故意不在列：那是网页自己的活，不抢。
 */
const FORWARD_KEYS = new Set(['q', 'w', 'l', 's', 'f', 'h', 'e', 'f11'])

/* ---------- 页面快照（browser.snapshot）：Accessibility 树 → 带 ref 的元素清单 ---------- */

/**
 * ref 台账：wcId →（ref → DOM 定位信息 + 展示用的 role/name）。
 * 每次快照整表覆盖；页签销毁随手摘掉。ref 是**每页签一份的易碎编号**——
 * 页面一变就可能失效，解析失败一律引导模型重新 snapshot，而不是猜。
 */
const snapshotRefs = new Map<number, Map<number, { backendNodeId: number; role: string; name: string }>>()

function guestOf(wcId: number): WebContents | null {
  const wc = webContents.fromId(wcId)
  return wc && !wc.isDestroyed() ? wc : null
}

/** 按需挂调试通道（Accessibility / DOM 两个域共用）；被占用多半是这页签开着 DevTools。
 *  attach 成功返回即已挂载（同步状态翻转），后续 sendCommand 的失败各自兜底。 */
function ensureDebugger(wc: WebContents): Debugger {
  const dbg = wc.debugger
  if (dbg.isAttached()) return dbg
  try {
    dbg.attach('1.3')
  } catch {
    throw new Error('调试通道被占用（这个页签可能开着开发者工具），拿不到页面快照')
  }
  return dbg
}

/** 单条 CDP 命令的兜底超时：页面卡死不该把 IPC 调用无限吊着 */
function cdp<T>(dbg: Debugger, method: string, params?: object, ms = 12_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(method + ' 超时（页面可能没有响应）')), ms)
    dbg
      .sendCommand(method, params)
      .then(
        (v) => {
          clearTimeout(t)
          resolve(v as T)
        },
        (e: unknown) => {
          clearTimeout(t)
          reject(e instanceof Error ? e : new Error(String(e)))
        },
      )
  })
}

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

function registerSnapshotIpc(): void {
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

/** 右键按下后的横向位移台账（wcId → 起点 x 与是否已算「划过」）：划过的右键不弹菜单 */
const markDrag = new Map<number, { x0: number; moved: boolean }>()

/* ---------- 页签日志采集（browser.logs / logDetail / record / fetch 的地基，见 shared/webLogs） ---------- */

const logBuffers = new Map<number, WebLogBuffer>()
/** 录制水位（browser.record(start) 钉下、stop 取走并清掉） */
const recMarks = new Map<number, number>()
/** cdp requestId → 网络条目：响应/加载完成回填用（重定向换条目，map 跟着改指） */
const netInflight = new Map<number, Map<string, WebNetLogEntry>>()

function bufferOf(wcId: number): WebLogBuffer {
  let buf = logBuffers.get(wcId)
  if (!buf) {
    buf = newWebLogBuffer()
    logBuffers.set(wcId, buf)
  }
  return buf
}

/** browser.fetch 在页面上下文跑的固定函数：参数是值（JSON 注入），函数体是死的——
 *  与 DOM_OPS 同一条纪律，没有任意 JS 的口子。credentials: 'include' 是「以这个页签
 *  登录态的身份」语义；同源 API 调用无 CORS 问题，跨域照样受页面自己的 CORS 约束。 */
const PAGE_FETCH_FN =
  'async function (spec) {' +
  '  const ctrl = new AbortController();' +
  '  const timer = setTimeout(function () { ctrl.abort() }, spec.timeoutMs || 15000);' +
  '  try {' +
  '    const res = await fetch(spec.url, {' +
  '      method: spec.method,' +
  '      headers: spec.headers,' +
  '      body: spec.method === "GET" || spec.method === "HEAD" || spec.body === undefined ? undefined : spec.body,' +
  '      credentials: "include",' +
  '      signal: ctrl.signal,' +
  '    });' +
  '    const contentType = res.headers.get("content-type") || "";' +
  '    let text = "";' +
  '    if (!contentType || /^(text\\/|application\\/(json|javascript|xml|xhtml|\\+json|\\+xml|urlencoded|form-data))/i.test(contentType)) {' +
  '      text = await res.text();' +
  '      const cap = spec.maxText || 65536;' +
  '      if (text.length > cap) text = text.slice(0, cap);' +
  '    }' +
  '    return { status: res.status, statusText: res.statusText, contentType: contentType, url: res.url, text: text, textBytes: text.length };' +
  '  } catch (e) {' +
  '    return { error: String((e && e.message) || e) };' +
  '  } finally {' +
  '    clearTimeout(timer);' +
  '  }' +
  '}'

/** webview 一挂上就开采集：Runtime/Log/Network 的事件流进环形缓冲。
 *  加载期的错误与请求（chunk 挂了、启动异常、首屏 API 失败）是诊断金矿，
 *  等第一次查询才挂通道就全漏了。DevTools（检查元素）要独占调试插槽：让它，关掉再收回。 */
function startCapture(contents: WebContents): void {
  const wcId = contents.id
  bufferOf(wcId)
  const dbg = contents.debugger
  try {
    dbg.attach('1.3')
  } catch {
    return // 槽位被占（创建时理论上不会）：采集缺席，查询回空，操作型 api 走 ensureDebugger 自己的报错
  }
  const inflight = new Map<string, WebNetLogEntry>()
  netInflight.set(wcId, inflight)
  const enable = (): void => {
    for (const domain of ['Runtime.enable', 'Log.enable', 'Network.enable']) {
      void dbg.sendCommand(domain).catch(() => {})
    }
  }
  enable()
  const onMessage = (_e: Electron.Event, method: string, params: Record<string, unknown>): void => {
    const buf = logBuffers.get(wcId)
    if (!buf) return
    const p = params ?? {}
    const at = Date.now()
    if (method === 'Runtime.consoleAPICalled') {
      const type = String(p.type ?? 'log')
      const level = type === 'error' ? 'error' : type === 'warning' ? 'warn' : type === 'debug' ? 'debug' : 'info'
      const stack = type === 'trace' ? flattenStack(p.stackTrace) : undefined
      pushConsoleLog(buf, at, { level, text: flattenConsoleArgs(p.args), ...(stack ? { stack } : {}) })
    } else if (method === 'Runtime.exceptionThrown') {
      const d = (p.exceptionDetails ?? {}) as {
        text?: string
        url?: string
        exception?: { description?: string }
        stackTrace?: { callFrames?: unknown }
      }
      const text = d.exception?.description ?? [d.text, d.url].filter(Boolean).join(' （') + (d.url ? '）' : '')
      pushConsoleLog(buf, at, {
        level: 'error',
        text: text.slice(0, 2000),
        ...(flattenStack(d.stackTrace?.callFrames) ? { stack: flattenStack(d.stackTrace?.callFrames) } : {}),
      })
    } else if (method === 'Log.entryAdded') {
      const e = (p.entry ?? {}) as { source?: string; level?: string; text?: string; url?: string }
      const level = e.level === 'error' ? 'error' : e.level === 'warning' ? 'warn' : e.level === 'verbose' ? 'debug' : 'info'
      const extra = e.url && !(e.text ?? '').includes(e.url) ? '（' + e.url + '）' : ''
      pushConsoleLog(buf, at, {
        level,
        text: ((e.text ?? '') + extra).slice(0, 2000),
      })
    } else if (method === 'Network.requestWillBeSent') {
      const req = (p.request ?? {}) as { url?: string; method?: string; headers?: unknown; postData?: string }
      const redirect = p.redirectResponse as Record<string, unknown> | undefined
      if (redirect) {
        // 重定向：同一 requestId 的上一跳落定，续跳开新条目
        const prev = inflight.get(String(p.requestId))
        if (prev) {
          prev.status = Number(redirect.status) || null
          prev.statusText = typeof redirect.statusText === 'string' ? redirect.statusText : undefined
          prev.mime = typeof redirect.mimeType === 'string' ? redirect.mimeType : undefined
          prev.ms = at - prev.at
        }
      }
      const entry = pushNetLog(buf, at, {
        method: String(req.method ?? 'GET').toUpperCase(),
        url: String(req.url ?? ''),
        status: null,
        type: String(p.type ?? 'Other'),
        ...(capHeaders(req.headers) ? { headers: capHeaders(req.headers) } : {}),
        ...(req.postData !== undefined ? { postData: capBodyText(String(req.postData)) } : {}),
        cdpRequestId: String(p.requestId),
      })
      inflight.set(String(p.requestId), entry)
    } else if (method === 'Network.responseReceived') {
      const entry = inflight.get(String(p.requestId))
      const res = (p.response ?? {}) as { status?: number; statusText?: string; mimeType?: string }
      if (entry) {
        entry.status = typeof res.status === 'number' ? res.status : entry.status
        entry.statusText = res.statusText || undefined
        entry.mime = res.mimeType || undefined
        if (typeof p.type === 'string' && p.type !== 'Other') entry.type = p.type
      }
    } else if (method === 'Network.loadingFinished') {
      const entry = inflight.get(String(p.requestId))
      if (!entry) return
      entry.size = typeof p.encodedDataLength === 'number' ? Math.round(p.encodedDataLength) : entry.size
      entry.ms = at - entry.at
      inflight.delete(String(p.requestId)) // 挂起台账：完了就出列（waitFor 的 networkIdle 数它）
      // API 响应体现采一份（XHR/Fetch、文本类）：详情与「分析网页发了什么」都靠它
      if (
        entry.cdpRequestId &&
        (entry.type === 'XHR' || entry.type === 'Fetch') &&
        isTextualMime(entry.mime) &&
        dbg.isAttached()
      ) {
        void dbg
          .sendCommand('Network.getResponseBody', { requestId: entry.cdpRequestId })
          .then((r) => {
            const body = (r as { body?: string; base64?: boolean }) ?? {}
            if (body.body !== undefined && !body.base64) {
              entry.body = {
                text: capBodyText(body.body),
                truncated: body.body.length > capBodyText(body.body).length,
                mime: entry.mime ?? '',
              }
            }
          })
          .catch(() => {})
      }
    } else if (method === 'Network.loadingFailed') {
      const entry = inflight.get(String(p.requestId))
      if (!entry) return
      entry.errorText = String(p.errorText ?? '失败') + (p.canceled ? '（已取消）' : '')
      entry.ms = at - entry.at
      inflight.delete(String(p.requestId))
    }
  }
  dbg.on('message', onMessage)
  contents.once('destroyed', () => {
    try {
      dbg.removeListener('message', onMessage)
      if (dbg.isAttached()) dbg.detach()
    } catch {
      /* 页签都没了，收尾失败无所谓 */
    }
    logBuffers.delete(wcId)
    recMarks.delete(wcId)
    netInflight.delete(wcId)
  })
  // 检查元素/用户 DevTools 要占调试插槽：让位（这页签的采集中断），关掉再收回
  contents.on('devtools-opened', () => {
    try {
      if (dbg.isAttached()) dbg.detach()
    } catch {
      /* 同上 */
    }
    inflight.clear()
  })
  contents.on('devtools-closed', () => {
    try {
      if (!dbg.isAttached()) {
        dbg.attach('1.3')
        enable()
      }
    } catch {
      /* 另一路（snapshot 等）先挂上了就归它 */
    }
  })
}

/** 检查元素前先给 DevTools 让出调试插槽（否则开不出/打不开面板） */
function yieldDebuggerToDevtools(contents: WebContents): void {
  try {
    const dbg = contents.debugger
    if (dbg.isAttached()) {
      dbg.detach()
      netInflight.get(contents.id)?.clear()
    }
  } catch {
    /* 让位失败就让它去报「调试通道被占用」 */
  }
}

/** 日志查询与直发请求的四个通道（browser.logs / logDetail / fetch / record） */
function registerLogIpc(): void {
  ipcMain.handle('web:logs', (_e, wcId: number, opts: unknown): WebLogsResult => {
    const buf = logBuffers.get(Number(wcId))
    if (!buf) return { error: '这一页签的日志缓冲不在了（页签已关）——api.browser.tabs() 换个活页签' }
    return queryWebLogs(buf, sanitizeLogsQuery(opts))
  })

  ipcMain.handle(
    'web:logDetail',
    async (_e, wcId: number, seq: number, opts: unknown): Promise<WebLogDetailResult> => {
      const buf = logBuffers.get(Number(wcId))
      if (!buf) return { error: '这一页签的日志缓冲不在了（页签已关）' }
      const detail = webLogDetail(buf, Number(seq))
      if (!detail) {
        return { error: '缓冲里没有这条（太旧被挤掉了，或条目号不对）——api.browser.logs 重拿现行清单' }
      }
      // 响应体按缓冲里存的回；不够长再向页面现查一次（缓冲淘汰后查不回，尽力而为）
      const maxBody = (() => {
        const v = (opts as { maxBody?: unknown } | null | undefined)?.maxBody
        return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.floor(v), 200), WEB_LOG_DETAIL_BODY_MAX) : WEB_LOG_DETAIL_BODY_MAX
      })()
      if (detail.kind === 'network') {
        const entry = buf.network.find((e) => e.seq === Number(seq))
        if (entry?.cdpRequestId && (!detail.responseBody || detail.responseBody.truncated)) {
          const wc = guestOf(wcId)
          if (wc) {
            try {
              const dbg = await ensureDebugger(wc)
              const r = (await cdp<{ body?: string; base64?: boolean }>(
                dbg,
                'Network.getResponseBody',
                { requestId: entry.cdpRequestId },
              )) ?? {}
              if (r.body !== undefined && !r.base64) {
                const text = capBodyText(r.body, maxBody)
                detail.responseBody = {
                  text,
                  truncated: r.body.length > text.length,
                  mime: entry.mime ?? '',
                }
              }
            } catch {
              /* 页面变了/体已被回收：保留缓冲里那份（可能没有） */
            }
          }
        }
        // 详情瘦身（实测教训：GraphQL 的全量 URL 单条 3000+ 字符，agent 只是想拿个地址）：
        // 头每值截 500；补一个「host + 路径 + 参数名」的短形态，全量 url 仍在
        const headers = detail.requestHeaders as Record<string, string> | undefined
        if (headers) {
          const trimmed: Record<string, string> = {}
          for (const [k, v] of Object.entries(headers)) trimmed[k] = v.length > 500 ? v.slice(0, 499) + '…' : v
          detail.requestHeaders = trimmed
        }
        if (typeof detail.url === 'string') {
          try {
            detail.urlPath = new URL(detail.url).host + apiPathKey(detail.url)
          } catch {
            /* url 不合法就不补短形态 */
          }
        }
      }
      return { detail }
    },
  )

  ipcMain.handle('web:record', (_e, wcId: number, action: string, opts: unknown): WebRecordResult => {
    const buf = logBuffers.get(Number(wcId))
    if (!buf) return { error: '这一页签的日志缓冲不在了（页签已关）——api.browser.tabs() 换个活页签' }
    if (action === 'start') {
      const since = buf.nextSeq - 1
      recMarks.set(wcId, since)
      return { ok: true, action: 'start', since }
    }
    if (action === 'stop') {
      const mark = recMarks.get(wcId)
      if (mark === undefined) {
        return { error: '这个页签没有进行中的录制——先 browser.record(tabId, "start") 起录' }
      }
      recMarks.delete(wcId)
      return { ...queryWebLogs(buf, { ...sanitizeLogsQuery(opts), afterSeq: mark }), action: 'stop' as const }
    }
    return { error: 'record 的动作只有 "start" / "stop"' }
  })

  ipcMain.handle(
    'web:pageFetch',
    async (_e, wcId: number, raw: unknown): Promise<WebPageFetchResult> => {
      const wc = guestOf(wcId)
      if (!wc) return { error: '这一页签的网页已经不在了' }
      const req = (raw ?? {}) as WebPageFetchReq
      let spec: WebFetchSpec
      if (typeof req.reqId === 'number' && Number.isFinite(req.reqId)) {
        const entry = logBuffers.get(wcId)?.network.find((e) => e.seq === req.reqId)
        if (!entry) {
          return { error: '缓冲里没有这条网络请求（太旧被挤掉了，或条目号不对）——api.browser.logs 重拿现行清单' }
        }
        const headers = {
          ...replayHeadersOf(entry.headers),
          ...(capHeaders(req.headers) ?? {}),
        }
        spec = {
          url: typeof req.url === 'string' && req.url.trim() ? req.url.trim() : entry.url,
          method: String(req.method ?? entry.method ?? 'GET').toUpperCase(),
          ...(Object.keys(headers).length ? { headers } : {}),
          body: req.body !== undefined ? String(req.body) : entry.postData,
          timeoutMs: clampTimeout(req.timeoutMs),
          ...(maxTextOf(req) ? { maxText: maxTextOf(req) } : {}),
        }
      } else {
        const url = typeof req.url === 'string' ? req.url.trim() : ''
        if (!/^https?:\/\//i.test(url)) {
          return { error: '要给 http(s) 网址，或 { reqId }（网络清单里的条目号）来重放页面发过的请求' }
        }
        spec = {
          url,
          method: String(req.method ?? 'GET').toUpperCase(),
          ...(capHeaders(req.headers) ? { headers: capHeaders(req.headers) } : {}),
          body: req.body !== undefined ? String(req.body) : undefined,
          timeoutMs: clampTimeout(req.timeoutMs),
          ...(maxTextOf(req) ? { maxText: maxTextOf(req) } : {}),
        }
      }
      if (spec.method === 'GET' || spec.method === 'HEAD') delete spec.body
      try {
        const dbg = ensureDebugger(wc)
        const r = await cdp<{
          result?: { value?: { error?: string; status?: number; statusText?: string; contentType?: string; url?: string; text?: string; textBytes?: number } }
          exceptionDetails?: { exception?: { description?: string } }
        }>(
          dbg,
          'Runtime.evaluate',
          { expression: '(' + PAGE_FETCH_FN + ')(' + JSON.stringify(spec) + ')', awaitPromise: true, returnByValue: true, userGesture: true },
          spec.timeoutMs + 10_000,
        )
        if (r.exceptionDetails) {
          return { error: '页面里请求失败：' + (r.exceptionDetails.exception?.description ?? '未知异常').slice(0, 300) }
        }
        const v = r.result?.value
        if (!v || (typeof v.status !== 'number' && !v.error)) {
          return { error: '页面里请求失败：拿不到响应' }
        }
        /*
         * **请求级失败不抛异常**：没拿到响应（CSP/CORS/超时/中止）回值 { status:0, failed, reason }，
         * agent 按值分支；只有参数/页签类错误才走上面的 error（抛给 execute）。
         * 实测教训：跨域被拒时 throw 会把整批 execute 连带已成功的结果一起带走。
         */
        if (v.error) {
          const reason = String(v.error)
          const timedOut = /abort/i.test(reason)
          return {
            status: 0,
            failed: true,
            reason: timedOut
              ? '超时：' + Math.round(spec.timeoutMs / 1000) + 's 内页面没回来（fetch 被中止）'
              : '页面里请求失败：' + reason + '——同源 API 没这个问题；跨域要过页面自己的 CORS/CSP',
          }
        }
        const maxBody = typeof req.maxBody === 'number' && Number.isFinite(req.maxBody)
          ? Math.min(Math.max(Math.floor(req.maxBody), 200), 262_144)
          : 4_000
        const text = v.text ?? ''
        const offset = typeof req.offset === 'number' && Number.isFinite(req.offset)
          ? Math.min(Math.max(Math.floor(req.offset), 0), Math.max(text.length - 1, 0))
          : 0
        // offset 越过末尾不再静默回空：带一句说明（实测教训：agent 以为分段坏了白试一轮）
        const pastEnd = offset >= text.length
        const body = pastEnd ? '' : text.slice(offset, offset + maxBody)
        const nextOffset = offset + body.length < text.length ? offset + body.length : undefined
        const replayed = typeof req.reqId === 'number'
          ? { url: spec.url, method: spec.method }
          : undefined
        const replayBounced = replayed && (v.status === 403 || v.status === 404)
        const status = typeof v.status === 'number' ? v.status : 0
        return {
          status,
          ...(replayed ? { replayed } : {}),
          ...(v.statusText ? { statusText: v.statusText } : {}),
          ...(v.contentType ? { contentType: v.contentType } : {}),
          ...(v.url ? { url: v.url } : {}),
          ...(body
            ? { body, ...(body.length < text.length - offset || nextOffset !== undefined ? { bodyTruncated: true } : {}) }
            : pastEnd
              ? { note: 'offset 已越过响应末尾（全文共 ' + text.length + ' 字符）——没有更多内容了' }
              : text.length
                ? { note: '响应不是文本类，不回内容' }
                : {}),
          ...(text.length ? { chars: v.textBytes ?? text.length, ...(offset ? { offset } : {}), ...(nextOffset !== undefined ? { nextOffset } : {}) } : {}),
          ...(replayBounced
            ? { note: '重放拿到 ' + v.status + '：捕获的请求头可能含一次性签名（x-client-transaction-id 之类）已过期——回 UI 重新触发一次同样的操作拿新 reqId，或直接用网址直发让页面自己带头' }
            : {}),
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : '页面请求失败' }
      }
    },
  )

  // 等条件成立（browser.waitFor）：「wait 一下、再取一次、还是空」循环的替代品。
  // 谓词全是固定原语——selector/text/url 在页面里跑固定表达式，networkIdle 数挂起台账，
  // agent 传不进自由 JS。250ms 轮询到成立或超时，超时回执带页面现状（url）供判断下一步。
  ipcMain.handle('web:waitFor', async (_e, wcId: number, raw: unknown): Promise<WebWaitResult> => {
    const wc = guestOf(wcId)
    if (!wc) return { error: '这一页签的网页已经不在了' }
    const req = (raw ?? {}) as WebWaitReq
    const selector = typeof req.selector === 'string' && req.selector.trim() ? req.selector.trim() : undefined
    const text = typeof req.text === 'string' && req.text.trim() ? req.text.trim() : undefined
    const urlIncludes = typeof req.urlIncludes === 'string' && req.urlIncludes.trim() ? req.urlIncludes.trim() : undefined
    const predicates: string[] = []
    if (req.load === true) predicates.push('load')
    if (selector) predicates.push('selector')
    if (text) predicates.push('text')
    if (urlIncludes) predicates.push('url')
    if (req.networkIdle === true) predicates.push('networkIdle')
    if (!predicates.length) {
      return { error: '要给至少一个等待条件：{ selector } / { text } / { urlIncludes } / { networkIdle: true } / { load: true }' }
    }
    const timeoutMs =
      typeof req.timeoutMs === 'number' && Number.isFinite(req.timeoutMs)
        ? Math.min(Math.max(Math.floor(req.timeoutMs), 500), 30_000)
        : 8_000
    const deadline = Date.now() + timeoutMs
    const dbg = (() => {
      try {
        return ensureDebugger(wc)
      } catch {
        return null // DevTools 占着插槽：selector/text 等不了，load/url/networkIdle 照样能等
      }
    })()
    for (;;) {
      let matched: 'selector' | 'text' | 'url' | 'networkIdle' | 'load' | null = null
      if (predicates.includes('load') && !wc.isLoading()) matched = 'load'
      if (!matched && selector && dbg) {
        try {
          const r = await cdp<{ result?: { value?: boolean } }>(dbg, 'Runtime.evaluate', {
            expression: '!!document.querySelector(' + JSON.stringify(selector) + ')',
            returnByValue: true,
          })
          if (r.result?.value === true) matched = 'selector'
        } catch {
          /* 页面正在跳转的瞬间会失败：当作还没满足，下一拍再试 */
        }
      }
      if (!matched && text && dbg) {
        try {
          const r = await cdp<{ result?: { value?: boolean } }>(dbg, 'Runtime.evaluate', {
            expression: '!!(document.body && document.body.innerText && document.body.innerText.indexOf(' + JSON.stringify(text) + ') >= 0)',
            returnByValue: true,
          })
          if (r.result?.value === true) matched = 'text'
        } catch {
          /* 同上 */
        }
      }
      if (!matched && urlIncludes && wc.getURL().includes(urlIncludes)) matched = 'url'
      if (!matched && req.networkIdle === true && !wc.isLoading() && (netInflight.get(wcId)?.size ?? 0) === 0) {
        matched = 'networkIdle'
      }
      if (matched !== null) {
        return { ok: true, matched, waitedMs: timeoutMs - Math.max(deadline - Date.now(), 0), url: wc.getURL() }
      }
      if (Date.now() >= deadline) {
        return {
          error:
            '等了 ' + timeoutMs + 'ms 条件没满足（' + predicates.join(' / ') + '）——页面当前在 ' + wc.getURL() +
            '：把条件放宽（比如先 scroll 再等 text）、拉长 timeoutMs，或改用截图看页面到底长什么样',
        }
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  })
}

function clampTimeout(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.floor(v), 1000), 60_000) : 15_000
}

/** 页面侧采文本上限：toTmp 全文模式把默认 64k 放宽（wrap 侧只在 toTmp 时设置） */
function maxTextOf(req: WebPageFetchReq): number | undefined {
  return typeof req.maxText === 'number' && Number.isFinite(req.maxText)
    ? Math.min(Math.max(Math.floor(req.maxText), 65_536), 262_144)
    : undefined
}

/**
 * guest 的指针事件上报（见 electron/guestPreload）：校验形状后原样转给主窗口，
 * 渲染层据此在对应的 <webview> 元素上合成可冒泡的 PointerEvent——「网页里触发的事件
 * 冒泡到宿主」走的就是这一条（右键横划换页签那一类手势因此能在网页页签里用）。
 * preload 只上报、不向页面世界暴露任何东西（contextIsolation 下页面摸不到它），
 * 所以这条通道的攻击面就只有「伪造指针事件」，伪造出来的也不过是让手势动一动。
 */
function registerGuestInputIpc(): void {
  ipcMain.on('web:guest-input', (e, raw: unknown) => {
    const p = raw as Partial<Record<'type' | 'x' | 'y' | 'button' | 'buttons', unknown>> | null
    if (!p || typeof p !== 'object') return
    const type = p.type
    if (type !== 'pointerdown' && type !== 'pointermove' && type !== 'pointerup') return
    const { x, y, button, buttons } = p
    if (typeof x !== 'number' || typeof y !== 'number' || typeof button !== 'number' || typeof buttons !== 'number') return
    // 右键台账：划动判定在这里记一份——右键菜单由这里弹，只有它知道「刚刚是不是手势」
    if (type === 'pointerdown' && button === 2) markDrag.set(e.sender.id, { x0: x, moved: false })
    else if (type === 'pointermove' && button === 2) {
      const d = markDrag.get(e.sender.id)
      if (d && Math.abs(x - d.x0) >= 4) d.moved = true
    }
    mainWindow()?.webContents.send('web:guest-input', { type, x, y, button, buttons, wcId: e.sender.id })
  })
}

export function setupWebBrowser(): void {
  const ses = session.fromPartition(WEB_PARTITION)
  registerSnapshotIpc()
  registerGuestInputIpc()
  registerLogIpc()

  // 只摘掉 Electron/… 尾巴，版本号用真实 Chromium 的，其余照抄正常 Chrome 的桌面 UA
  ses.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
      process.versions.chrome +
      ' Safari/537.36',
  )

  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen'])
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(allowed.has(permission))
  })
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  app.on('web-contents-created', (_e, contents) => {
    // 宿主（主窗口 / 考试窗口）：webview 挂上来之前收掉一切特权——纵深防御，
    // 就算渲染层被人改了属性，guest 也拿不到 node 与主窗口那份预载脚本
    if (contents.getType() === 'window') {
      contents.on('will-attach-webview', (_e2, webPreferences, params) => {
        // 预载换成我们自己的**最小脚本**（electron/guestPreload：只上报指针事件，
        // 好让网页里的事件能冒泡到宿主）。node 照旧关死，contextIsolation 默认开着，
        // 页面世界摸不到预载世界里的 ipcRenderer。
        webPreferences.preload = join(__dirname, 'guestPreload.cjs')
        webPreferences.nodeIntegration = false
        if (params.partition !== WEB_PARTITION) params.partition = WEB_PARTITION
      })
      return
    }
    if (contents.getType() !== 'webview') return

    // 页签一挂上就开日志采集（Runtime/Log/Network → 环形缓冲），页签销毁时随台账一起清
    startCapture(contents)

    // 页签销毁：ref 台账随手摘掉（台账按 wcId 记，留着也是幽灵键）
    contents.once('destroyed', () => snapshotRefs.delete(contents.id))

    // 网页想开新窗口：一律不开原生窗——http(s) 落成应用里的新 web 页签，mailto 给系统，
    // 其余（data:、blob:…）直接拒
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('mailto:')) void shell.openExternal(url)
      else if (canOpenExternal(url)) mainWindow()?.webContents.send('web:openTab', url)
      return { action: 'deny' }
    })

    /*
     * guest 的右键菜单：弹**原生菜单**（就落在网页里，而不是应用层再糊一张）。
     * 复制 / 粘贴用 role：它们作用于**聚焦的 WebContents**——右键此刻在 guest 里，正好。
     * 右键横划是换页签的手势（渲染层在文档区接；事件经 web:guest-input 上来）：
     * 划过了就不弹，否则每划一次都跳出一份菜单。
     */
    contents.on('context-menu', (e2, params) => {
      e2.preventDefault()
      const d = markDrag.get(contents.id)
      markDrag.delete(contents.id)
      if (d?.moved) return
      Menu.buildFromTemplate([
        { label: t('复制'), role: 'copy', enabled: params.editFlags.canCopy },
        { label: t('粘贴'), role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: t('刷新'), click: () => contents.reload() },
        { type: 'separator' },
        /*
         * 检查元素：开的是 **guest** 的 DevTools（inspectElement 作用于这份 WebContents），
         * 与宿主窗口自己的 DevTools 互不相干。默认 dock 进宿主窗口会把网页区挤一条缝，
         * 所以先按应用的惯例开成独立窗（windows.ts 同款），再定位到点的那个元素。
         */
        {
          label: t('检查元素'),
          click: () => {
            // DevTools 要独占调试插槽：先把日志采集让位（暂停），关掉 DevTools 会自动收回
            yieldDebuggerToDevtools(contents)
            if (!contents.isDevToolsOpened()) contents.openDevTools({ mode: 'detach' })
            contents.inspectElement(params.x, params.y)
          },
        },
      ]).popup({ window: BrowserWindow.fromWebContents(contents.hostWebContents ?? contents) ?? undefined })
    })

    contents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return
      // 功能键（F11）不带修饰键；其余只转 Ctrl/Meta（无 Alt/Shift）的应用组合
      const bare = /^F\d{1,2}$/.test(input.key)
      if (!bare && (!(input.control || input.meta) || input.alt || input.shift)) return
      const key = input.key.toLowerCase()
      if (!FORWARD_KEYS.has(key)) return
      e.preventDefault()
      mainWindow()?.webContents.send('web:shortcut', key)
    })
  })
}

import { useEffect, useMemo, useRef } from 'react'
import { themeCssBlock } from '../../lib/themeTokens'
import { isDarkTheme, type ThemeMode } from '../../lib/appearance'
import { katexIframeCss, renderEmbeddedMarkdown } from '../../lib/superdocHtml'
// KaTeX 的样式表原文：moji-markdown 里渲染出来的公式全靠这些类排布。
// index.css 进不了 iframe，这份必须一并注入——否则公式散成一堆上下错位的 span。
//
// 注入前先过一道 katexIframeCss：把 @font-face 全删掉、改成用 MathML 排。
// 字体在这个 opaque origin 里必然加载失败（相对地址 + CORS，见那个函数的注释），
// 而控制台那一串报错就是它——这不是「忍着」的事，是本来就不该带字体进来。
import katexCss from 'katex/dist/katex.min.css?raw'
import { t } from '../../i18n'

/** 处理一次就够：raw 是常量，正则也不便宜 */
const KATEX_IFRAME_CSS = katexIframeCss(katexCss)

/**
 * 超级文档的渲染器：Agent 生成的可交互 HTML，跑在沙箱化的 iframe 里。
 *
 * 为什么是 iframe、而且脚本不「抽出来」再执行：这类文档的灵魂是 <script>——
 * 按钮要点得动、状态要能显示，脚本就必须活在 DOM 旁边。但它们绝不能跑在
 * 应用页面本身：页面里有整套 preload 桥与用户数据。折衷就是浏览器原生的那间
 * 单人牢房——`sandbox="allow-scripts"`（**不给** allow-same-origin）：
 * 脚本正常执行、DOM 随便操作，但源是 opaque 的，碰不到父页面、localStorage、
 * cookie，也发不出跨域请求（CSP 随宿主页面一并继承，connect-src 只留 llm-proxy:）。
 * 「抽出脚本放沙箱执行」在这个架构里就落成这一条：脚本连同 HTML 一起，
 * 从头到尾只存在于这间牢房里。
 *
 * 牢房有三条受控的对外通道（都走 postMessage，宿主逐条校验消息形状）：
 * - method 桥：宿主预先注入全局 `api`，`api.method.call(name, args)` 找宿主执行
 *   **目标级持久化**的函数（learn/methods）并把结果送回来。想拿数据，必须先有
 *   一个 Agent 写好的函数——除此之外没有第二条出路。
 * - 跳转桥：文档里的 `moji:super/…` 链接（内置语法，见 lib/nodeLink）在捕获阶段
 *   被 BRIDGE 拦下，转回宿主打开对应的超级文档页签。
 * - 主题桥：文档里的 `var(--color-seal)` 等变量由宿主注入的 `<style>` 供给，
 *   **实时跟随应用主题**——宿主盯住自己的 data-theme，一变就把一份新的
 *   `:root{…}` 推进牢房（见 lib/themeTokens）。生成时是浅色、现在切到深色，
 *   文档配色跟着走，状态不丢、页面不重载。
 */

interface Props {
  /** 这份超级文档的 HTML 源码（完整文档；片段也会被浏览器补全） */
  html: string
  /** method 桥的宿主侧：执行一个持久化函数并返回结果（见 LearnWorkspace 的装配） */
  onMethodCall: (name: string, args: unknown[]) => Promise<unknown>
  /** 文档里的 moji:super 链接被点下（BRIDGE 拦截后转回来）；宿主负责打开对应页签 */
  onSuperLink: (href: string) => void
}

/**
 * 注入给文档的桥。做成一段自包含的 IIFE 拼在文档最前面：
 * - 建一块 `<style data-moji-theme>`（初始内容由宿主在 srcDoc 里一并写入），
 *   收到 `theme` 消息就整块替换——主题切换是**换变量**，不是重开页面；
 * - 定义 `window.api.method.call(name, ...args)`，postMessage 到父页并等回执；
 * - 就绪时向父页发一条 `ready`：宿主收到立刻补发当前主题——
 *   「切主题的那一刻文档正在加载」的窄窗口由这一握收口。
 * 文档自己的脚本在桥之后执行，拿到的 `api` 已经就位。
 */
const BRIDGE = `<script>(function(){
  var seq = 0
  var pending = {}
  var themeEl = null
  function ensureTheme() {
    if (themeEl) return themeEl
    themeEl = document.createElement('style')
    themeEl.setAttribute('data-moji-theme', '')
    document.head.appendChild(themeEl)
    return themeEl
  }
  window.addEventListener('message', function (ev) {
    var d = ev.data
    if (!d || d.__mojiSuper !== true) return
    if (d.type === 'theme' && typeof d.css === 'string') {
      ensureTheme().textContent = d.css
      return
    }
    if (d.type !== 'reply') return
    var p = pending[d.id]
    if (!p) return
    delete pending[d.id]
    if (d.ok) p.resolve(d.value)
    else p.reject(new Error(d.error || '调用失败'))
  })
  window.api = {
    method: {
      call: function (name) {
        var args = Array.prototype.slice.call(arguments, 1)
        return new Promise(function (resolve, reject) {
          var id = ++seq
          pending[id] = { resolve: resolve, reject: reject }
          parent.postMessage({ __mojiSuper: true, type: 'call', id: id, name: name, args: args }, '*')
        })
      },
    },
  }
  // moji:super 链接：捕获阶段拦下（文档自己的脚本没机会吃掉它），转回宿主开页签
  document.addEventListener(
    'click',
    function (ev) {
      var t = ev.target
      if (!t || !t.closest) return
      var a = t.closest('a[href^="moji:super"]')
      if (!a) return
      ev.preventDefault()
      ev.stopPropagation()
      parent.postMessage({ __mojiSuper: true, type: 'super', href: a.getAttribute('href') }, '*')
    },
    true,
  )
  parent.postMessage({ __mojiSuper: true, type: 'ready' }, '*')
})()</script>`

/** 文档头部注入的两块东西：主题变量（含基础观感）+ 桥。宿主拼 srcDoc 时调用 */
function composeDoc(html: string): string {
  // 内置 markdown 元素先渲染成正文（见 lib/superdocHtml）：原文不动，只变这一份渲染副本
  const rendered = renderEmbeddedMarkdown(html)
  const head = '<style data-moji-theme>' + fullThemeCss() + '</style>' + BRIDGE
  const headOpen = /<head[^>]*>/i.exec(rendered)
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length
    return rendered.slice(0, at) + head + rendered.slice(at)
  }
  return head + rendered
}

/** 切主题要推进去的完整一份：变量 + 基础观感（与 composeDoc 注入的同一份，改一处两头生效） */
function fullThemeCss(): string {
  /*
   * 基础观感是「文档什么都不写也能跟上主题」的底线：html 默认正文色与字体取自变量，
   * color-scheme 让滚动条、输入框这些 UA 控件也按深浅着装。模型自己写了样式的部分
   * （body 起覆盖）自然压过这一层。后面两段照抄宿主：
   * - 滚动条（index.css 的同款）：index.css 的规则进不了 iframe，不抄一份滚动条就
   *   停留在 UA 默认的灰色，永远不跟主题；
   * - moji-markdown 的排版（lib/superdocHtml 的内置 markdown 元素）：
   *   渲染出来的标题/列表/代码块在 iframe 里没有 index.css 可借，这里给一套
   *   以主题变量着色的最小排版。
   * - KaTeX 样式表（katex.min.css 原文经 ?raw 引入，再过一遍 katexIframeCss）：
   *   公式渲染的类全在它身上，而字体一条都不带——公式改用浏览器原生 MathML 排。
   *   字体在这个 opaque origin 里必然加载失败（相对地址 + CORS，见那个函数的注释），
   *   而「字体加载失败」也不是「回落到衬线体」那么温和：KaTeX 的 HTML 版靠字体度量排版，
   *   少一个字体就散成一堆上下错位的 span。所以不是忍着，而是本来就不该带字体进来。
   */
  const theme = (document.documentElement.dataset.theme ?? 'light') as ThemeMode
  const base =
    'html{color:var(--color-ink);font-family:var(--font-sans);color-scheme:' +
    (isDarkTheme(theme) ? 'dark' : 'light') + '}'
  const scrollbar =
    '*{scrollbar-width:thin;scrollbar-color:var(--color-scroll) transparent}' +
    '*::-webkit-scrollbar{width:10px;height:10px}' +
    '*::-webkit-scrollbar-thumb{background-color:var(--color-scroll);border-radius:999px;' +
    'border:3px solid transparent;background-clip:content-box}' +
    '*::-webkit-scrollbar-thumb:hover{background-color:var(--color-scroll-strong);background-clip:content-box}' +
    '*::-webkit-scrollbar-track,*::-webkit-scrollbar-corner{background:transparent}'
  const markdown =
    'moji-markdown{display:block;margin:10px 0;border-left:2px solid var(--color-line);padding:2px 0 2px 14px}' +
    'moji-markdown>*:first-child{margin-top:0}moji-markdown>*:last-child{margin-bottom:0}' +
    'moji-markdown h1,moji-markdown h2,moji-markdown h3,moji-markdown h4{margin:.7em 0 .4em;font-weight:600;line-height:1.35}' +
    'moji-markdown h1{font-size:1.5em}moji-markdown h2{font-size:1.28em}moji-markdown h3{font-size:1.12em}' +
    'moji-markdown p{margin:.45em 0;line-height:1.75}' +
    'moji-markdown ul,moji-markdown ol{margin:.45em 0;padding-left:1.5em}' +
    'moji-markdown li{margin:.15em 0;line-height:1.7}' +
    'moji-markdown code{background:var(--color-code);padding:.1em .35em;border-radius:3px;font-family:var(--font-mono);font-size:.9em}' +
    'moji-markdown pre{background:var(--color-code);padding:10px 12px;overflow-x:auto;border-radius:4px;margin:.5em 0}' +
    'moji-markdown pre code{background:transparent;padding:0}' +
    'moji-markdown blockquote{margin:.5em 0;padding-left:10px;border-left:2px solid var(--color-line);color:var(--color-quote-ink,var(--color-ink-soft))}' +
    'moji-markdown table{border-collapse:collapse;margin:.5em 0}' +
    'moji-markdown th,moji-markdown td{border:1px solid var(--color-line);padding:4px 10px}' +
    'moji-markdown a{color:var(--color-seal);text-decoration:underline}' +
    'moji-markdown img{max-width:100%}'
  return themeCssBlock() + base + KATEX_IFRAME_CSS + scrollbar + markdown
}

export default function SuperDocView({ html, onMethodCall, onSuperLink }: Props) {
  const srcDoc = useMemo(() => composeDoc(html), [html])
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  /** 桥要跑的宿主侧函数挂在 ref 上：监听器只挂一次，不随回调身份重建 */
  const callRef = useRef(onMethodCall)
  const superLinkRef = useRef(onSuperLink)
  useEffect(() => {
    callRef.current = onMethodCall
    superLinkRef.current = onSuperLink
  })

  useEffect(() => {
    /** 主题变了（或文档刚就绪）：把当前主题的变量整块推进去 */
    const pushTheme = () => {
      const css = fullThemeCss()
      const win = iframeRef.current?.contentWindow
      if (!css || !win) return
      win.postMessage({ __mojiSuper: true, type: 'theme', css }, '*')
    }
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as { __mojiSuper?: boolean; type?: string; id?: number; name?: unknown; args?: unknown; href?: unknown }
      if (!d || d.__mojiSuper !== true) return
      if (d.type === 'ready') {
        // srcDoc 里的主题块是「合成那一刻」的值；文档晚于最后一次切主题加载时由这一握补齐
        pushTheme()
        return
      }
      if (d.type === 'super') {
        // 文档里的 moji:super 链接被点了（BRIDGE 捕获阶段拦的）：转给宿主开页签
        if (typeof d.href === 'string' && d.href) superLinkRef.current(d.href)
        return
      }
      if (d.type !== 'call') return
      const source = ev.source as Window | null
      const reply = (ok: boolean, value: unknown, error?: string) => {
        // 回给 ev.source 而不是 iframe ref：回执到达时框架一定还在，source 一定有效
        source?.postMessage({ __mojiSuper: true, type: 'reply', id: d.id, ok, ...(ok ? { value } : { error }) }, '*')
      }
      const name = typeof d.name === 'string' ? d.name : ''
      const args = Array.isArray(d.args) ? d.args : []
      if (!name) {
        reply(false, null, 'api.method.call 的第一个参数要是函数名')
        return
      }
      Promise.resolve()
        .then(() => callRef.current(name, args))
        .then((value) => reply(true, value))
        .catch((err: unknown) => reply(false, null, err instanceof Error ? err.message : String(err)))
    }
    window.addEventListener('message', onMessage)
    // 盯宿主自己的主题开关：data-theme 一变，把新变量推给还开着的超级文档
    const observer = new MutationObserver(pushTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      window.removeEventListener('message', onMessage)
      observer.disconnect()
    }
  }, [])

  return (
    /*
     * h-full + 自身滚动：文档长什么样是它自己的事，宿主不掺和它的内部滚动
     * （文档里的滚动条、锚点都归它自己管）。
     */
    <div className="h-full min-h-0 flex-1 overflow-hidden bg-card">
      <iframe
        ref={iframeRef}
        title={t('超级文档')}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        className="h-full w-full border-0 bg-card"
      />
    </div>
  )
}

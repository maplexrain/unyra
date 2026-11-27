/**
 * 单个智能体浏览器 guest。
 *
 * 它只负责把 webview 挂到全局 host 上，并把 Electron 页面事件转成 AgentBrowserRuntime
 * 的状态；真正的定位/裁切由父层 AgentBrowserHost 决定。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { WebviewTag } from 'electron'
import { agentBrowserRuntime } from '../../../learn/web/agentBrowser'

/** React 对 webview 的布尔属性只警告不落 DOM；必须传字符串，target=_blank 才能用 */
const ALLOW_POPUPS = 'true' as unknown as boolean

export default function AgentBrowserWebview({
  sessionId,
  url,
  style,
  interactive,
}: {
  sessionId: string
  url: string
  style: CSSProperties
  interactive: boolean
}) {
  // 地址只在挂载时取一次；之后的跳转由 guest 自己走，Manager 通过事件回写状态
  const [src] = useState(url)
  const wvRef = useRef<WebviewTag | null>(null)

  useEffect(() => {
    const wv = wvRef.current
    if (!wv) return
    const emit = (event: string) => (e: Event) => {
      agentBrowserRuntime.handleWebviewEvent(sessionId, event, e)
    }
    const onDomReady = (e: Event): void => {
      agentBrowserRuntime.handleWebviewEvent(sessionId, 'dom-ready', e)
      agentBrowserRuntime.rememberGuest(
        sessionId,
        wv as unknown as Parameters<typeof agentBrowserRuntime.rememberGuest>[1],
      )
    }
    const handlers: Array<[string, EventListener]> = [
      ['dom-ready', onDomReady],
      ['did-start-loading', emit('did-start-loading')],
      ['did-stop-loading', emit('did-stop-loading')],
      ['did-navigate', emit('did-navigate')],
      ['did-navigate-in-page', emit('did-navigate-in-page')],
      ['page-title-updated', emit('page-title-updated')],
      ['page-favicon-updated', emit('page-favicon-updated')],
      ['render-process-gone', emit('render-process-gone')],
      ['enter-html-full-screen', () => {
        wv.style.position = 'fixed'
        wv.style.inset = '0'
        wv.style.zIndex = '60'
        wv.style.width = '100vw'
        wv.style.height = '100vh'
      }],
      ['leave-html-full-screen', () => {
        wv.style.position = ''
        wv.style.inset = ''
        wv.style.zIndex = ''
        wv.style.width = '100%'
        wv.style.height = '100%'
        wv.style.display = 'flex'
      }],
    ]
    const onFail = (e: Event): void => {
      const d = e as unknown as { errorCode?: number; isMainFrame?: boolean; errorDescription?: string }
      // -3 是换地址/停加载的中断，不当作失败
      if (d.errorCode === -3) return
      agentBrowserRuntime.handleWebviewEvent(sessionId, 'did-fail-load', d)
    }
    handlers.push(['did-fail-load', onFail])
    for (const [name, handler] of handlers) wv.addEventListener(name, handler)
    return () => {
      for (const [name, handler] of handlers) wv.removeEventListener(name, handler)
    }
  }, [sessionId])

  const setRef = useCallback(
    (el: Element | null) => {
      wvRef.current = (el as WebviewTag | null) ?? null
      agentBrowserRuntime.registerWebview(
        sessionId,
        (el as unknown as Parameters<typeof agentBrowserRuntime.registerWebview>[1]) ?? null,
      )
    },
    [sessionId],
  )

  return (
    <webview
      ref={setRef}
      src={src}
      partition="persist:web"
      allowpopups={ALLOW_POPUPS}
      style={{ ...style, pointerEvents: interactive ? 'auto' : 'none', display: 'flex' }}
    />
  )
}

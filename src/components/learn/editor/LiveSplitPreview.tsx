import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  createContext,
  type ReactNode,
  type CSSProperties,
} from 'react'
import MarkdownView from '../../MarkdownView'
import { renderNoteGfm } from '../../../lib/markdown'
import { t } from '../../../i18n'
import { subscribeEditorPreview, subscribeEditorPreviewSwap } from './previewBus'
import {
  useAppearance,
  getAppearance,
  setAppearance,
  clampDocScale,
  SCALE_ZOOM_STEP,
  SCALE_HUD_MS,
} from '../../../lib/appearance'

/**
 * 编辑栏光标同步上下文：编辑栏光标移动时驱动预览画面精准跟随对齐
 */
export type CursorBindingCallback = (ratio: number) => void
export const EditorCursorBindingContext = createContext<CursorBindingCallback | null>(null)

interface PreviewState {
  isOpen: boolean
  splitRatio: number
  isSwapped: boolean
}

const memoryState = new Map<string, PreviewState>()

function loadPreviewState(key?: string): PreviewState {
  if (key && memoryState.has(key)) {
    return memoryState.get(key)!
  }
  // localStorage：跨重启持久化（用户口径：分栏的开合/比例/对调关掉应用再开还原样）
  if (typeof localStorage !== 'undefined' && key) {
    try {
      const raw = localStorage.getItem(`moji:split-preview:${key}`)
      if (raw) {
        const parsed = JSON.parse(raw) as PreviewState & { v?: number }
        /*
         * v2 起「对调」以**编辑在左、预览在右**为基准（2026-11-14 默认位置改：原先
         * 预览在左）。旧记录没有版本标记——对调标记一次性回默认：旧默认下没对调过的
         * 文件直接拿新默认；手动对调到「编辑在左」的文件本来就在编辑在左，视觉不变。
         * 开合与比例原样保留。
         */
        const state: PreviewState = {
          isOpen: parsed.isOpen !== false,
          splitRatio:
            typeof parsed.splitRatio === 'number' && Number.isFinite(parsed.splitRatio)
              ? parsed.splitRatio
              : 50,
          isSwapped: parsed.v === 2 ? parsed.isSwapped === true : false,
        }
        memoryState.set(key, state)
        return state
      }
    } catch {
      // 忽略容错
    }
  }
  // 默认打开分栏实时预览（笔记 / markdown / html 默认编辑 + 分栏展开，见 tabs 的 viewOf）
  return { isOpen: true, splitRatio: 50, isSwapped: false }
}

function savePreviewState(key: string | undefined, state: PreviewState): void {
  if (!key) return
  memoryState.set(key, state)
  if (typeof localStorage !== 'undefined') {
    try {
      // v2：「对调」的基准从预览在左换成编辑在左（见 loadPreviewState 的迁移说明）
      localStorage.setItem(`moji:split-preview:${key}`, JSON.stringify({ ...state, v: 2 }))
    } catch {
      // 忽略
    }
  }
}

/**
 * HTML 预览的常驻 iframe。首挂用 srcDoc 装载一次；之后的修改**不走 srcDoc**
 * （它一动就是一次导航重载，逐字输入时预览整页闪白）——而是停手 400ms 后把
 * 最新文档 doc.write 进既有的 iframe 文档：同步的 DOM 整体替换，没有导航、
 * 没有白屏等待，闪烁就没了。
 */
function HtmlPreviewFrame({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  /** 首挂装的那一份（srcDoc 只在挂载时生效一次） */
  const [bootHtml, setBootHtml] = useState(html)
  const latestRef = useRef(html)
  const firstRunRef = useRef(true)
  useEffect(() => {
    latestRef.current = html
  })
  useEffect(() => {
    // 挂载那次跳过（bootHtml 已经是同一份），只盯后续的修改
    if (firstRunRef.current) {
      firstRunRef.current = false
      return
    }
    const t = window.setTimeout(() => {
      const doc = frameRef.current?.contentDocument
      if (!doc) return
      try {
        doc.open()
        doc.write(latestRef.current)
        doc.close()
      } catch {
        // 同源拿不到文档（兜底）：退回 srcDoc 重载
        setBootHtml(latestRef.current)
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [html])
  return (
    <iframe
      ref={frameRef}
      srcDoc={bootHtml}
      title={t('HTML 实时预览')}
      sandbox="allow-same-origin"
      className="h-full w-full border-none bg-white dark:bg-card"
    />
  )
}

interface Props {
  /** 源码编辑器的当前代码文本 */
  value: string
  /** 文件后缀（如 .md, .html, .ts 等） */
  ext?: string
  /** 源码编辑器组件实例 */
  children: ReactNode
  /** 持久化记忆与保活专属 key（如 tabId 或文件路径） */
  storageKey?: string
  /** 是否由外部强制控制（可选） */
  open?: boolean
  /** 状态变化回调 */
  onOpenChange?: (open: boolean) => void
}

/**
 * 编辑页面内置的双栏实时预览组件：
 *
 * 核心特性：
 * 1. 默认打开分栏实时预览，**编辑在左、预览在右**（对调互换，持久化记录见 loadPreviewState 的 v2 迁移），支持点击悬浮按钮或输入 Vim :preview 命令切换；
 * 2. 状态保持与 keepalive：每个文件的展开状态、分割比例与对调状态在切页签后完整保活；
 * 3. 完整布局拉伸：消除底部黑色空白，全高无缝自适应；
 * 4. 完整正文渲染：搭载 note-preview 与 moji-node-note 规范样式，Markdown 层级排版无缺漏；
 * 5. 响应式布局：当容器宽度小于 800px 时，自动由左右分割转为上下分割。
 */
export default function LiveSplitPreview({
  value,
  ext = '',
  children,
  storageKey,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const initial = useMemo(() => loadPreviewState(storageKey), [storageKey])
  const [internalOpen, setInternalOpen] = useState(initial.isOpen)
  const [splitRatio, setSplitRatio] = useState(initial.splitRatio) // 源码占比（%）
  const [isSwapped, setIsSwapped] = useState(initial.isSwapped) // 是否对调两列（基准 = 编辑在左，见 loadPreviewState 的 v2 迁移说明）

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen

  const setIsOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const target = typeof next === 'function' ? next(isOpen) : next
      setInternalOpen(target)
      onOpenChange?.(target)
      savePreviewState(storageKey, { isOpen: target, splitRatio, isSwapped })
    },
    [isOpen, onOpenChange, storageKey, splitRatio, isSwapped],
  )

  // 状态变更即时同步到持久化记忆中
  useEffect(() => {
    savePreviewState(storageKey, { isOpen, splitRatio, isSwapped })
  }, [storageKey, isOpen, splitRatio, isSwapped])

  // 订阅 Vim :preview 命令与全局切换广播；点名广播（key）只命中 storageKey 对得上的这一份
  useEffect(() => {
    return subscribeEditorPreview((force, key) => {
      if (key !== undefined && key !== storageKey) return
      setIsOpen((prev) => (force !== undefined ? force : !prev))
    })
  }, [setIsOpen, storageKey])

  // 订阅 :preview switch 的对调广播：翻转两列，落盘由下面那个同步 effect 顺带完成
  useEffect(() => {
    return subscribeEditorPreviewSwap(() => {
      setIsSwapped((s) => !s)
    })
  }, [])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const [isVertical, setIsVertical] = useState(false)
  const isDraggingRef = useRef(false)

  // 光标同步：接收编辑栏光标行百分比，驱动预览容器同步平滑滚动
  const onCursorRatio = useCallback((ratio: number) => {
    const el = previewScrollRef.current
    if (!el) return
    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll <= 0) return
    const targetTop = Math.max(0, Math.min(maxScroll, ratio * maxScroll))
    el.scrollTo({ top: targetTop, behavior: 'auto' })
  }, [])

  // 响应式监听：容器宽度小于 800px 时自动转为上下分割
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const checkDimension = (width: number) => {
      setIsVertical(width > 0 && width < 800)
    }

    checkDimension(el.clientWidth)

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          checkDimension(entry.contentRect.width)
        }
      })
      ro.observe(el)
      return () => ro.disconnect()
    }
  }, [])

  // 分割线拖拽处理
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    const el = containerRef.current
    if (!el) return

    const startX = e.clientX
    const startY = e.clientY
    const rect = el.getBoundingClientRect()
    const initialRatio = splitRatio

    const onPointerMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return
      let newRatio: number
      if (isVertical) {
        const delta = ev.clientY - startY
        const total = rect.height || 1
        newRatio = initialRatio + (delta / total) * 100
      } else {
        const delta = ev.clientX - startX
        const total = rect.width || 1
        newRatio = initialRatio + (delta / total) * 100
      }
      // 限制分栏比例在 20% ~ 80% 之间
      newRatio = Math.max(20, Math.min(80, newRatio))
      setSplitRatio(newRatio)
    }

    const onPointerUp = () => {
      isDraggingRef.current = false
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // 双击分割线对调两列
  const handleDoubleClick = () => {
    setIsSwapped((s) => !s)
  }

  /*
   * 预览列的字号缩放：**与阅读页面共用同一份 docScale**（外观设置里的那个），
   * Ctrl + 滚轮调，步进与钳制同 lib/appearance 的一套——两处看到的倍速永远一致。
   * Markdown 分支才有（HTML 分支是 iframe，没有可缩放的正文排版）。
   */
  const appearance = useAppearance()
  const isMdPreview = ext !== '.html' && ext !== '.htm'
  const [zoomHud, setZoomHud] = useState<number | null>(null)
  const zoomTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isOpen || !isMdPreview) return
    const el = previewScrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // 与浏览页同一套折算：像素模式一格约 100，行模式一格约 3 行，触控板小步按比例
      const unit = e.deltaMode === 1 ? 3 : 100
      const notches = Math.max(-3, Math.min(3, -e.deltaY / unit))
      if (!notches) return
      const next = clampDocScale(getAppearance().docScale * SCALE_ZOOM_STEP ** notches)
      setAppearance({ ...getAppearance(), docScale: next })
      setZoomHud(Math.round(next * 100))
      if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = window.setTimeout(() => {
        zoomTimerRef.current = null
        setZoomHud(null)
      }, SCALE_HUD_MS)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (zoomTimerRef.current !== null) {
        window.clearTimeout(zoomTimerRef.current)
        zoomTimerRef.current = null
      }
    }
  }, [isOpen, isMdPreview])

  // 实时编译 Markdown 或 HTML 预览内容
  const previewContent = useMemo(() => {
    if (!isOpen) return null

    const isHtml = ext === '.html' || ext === '.htm'
    if (isHtml) {
      // 剥离外链与脚本，安全渲染（增量替换见 HtmlPreviewFrame）
      const safeHtml = value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<link\b[^>]*\brel=["']?(?:modulepreload|preload)["']?[^>]*>/gi, '')
      return <HtmlPreviewFrame html={safeHtml} />
    }

    // Markdown 实时渲染：套入 note-preview moji-node-note doc-measure 完整样式体系
    const html = renderNoteGfm(value)
    return (
      <div ref={previewScrollRef} className="h-full w-full min-h-0 overflow-y-auto overflow-x-hidden">
        <div
          className="note-preview moji-node-note doc-measure relative px-7 pt-4 pb-10"
          style={{ '--doc-scale': appearance.docScale } as CSSProperties}
        >
          <MarkdownView html={html} />
        </div>
      </div>
    )
  }, [isOpen, value, ext, appearance.docScale])

  if (!isOpen) {
    return (
      <EditorCursorBindingContext.Provider value={onCursorRatio}>
        <div className="relative flex flex-col h-full w-full min-h-0 flex-1 overflow-hidden">{children}</div>
      </EditorCursorBindingContext.Provider>
    )
  }

  // 分配尺寸：比例跟着**栏**走——源码栏永远占 splitRatio%，预览栏占余下（对调只换位置不换宽窄，
  // 「源码占比」这句注释在任何布局下都字面成立）
  const sourcePaneStyle = isVertical
    ? { height: `${splitRatio}%`, width: '100%' }
    : { width: `${splitRatio}%`, height: '100%' }

  const previewPaneStyle = isVertical
    ? { height: `${100 - splitRatio}%`, width: '100%' }
    : { width: `${100 - splitRatio}%`, height: '100%' }

  const sourcePane = (
    <div
      key="source-pane"
      style={sourcePaneStyle}
      className="relative shrink-0 overflow-hidden flex flex-col h-full min-h-0 min-w-0"
    >
      <div className="relative flex flex-col h-full w-full min-h-0 flex-1">
        <EditorCursorBindingContext.Provider value={onCursorRatio}>
          {children}
        </EditorCursorBindingContext.Provider>
      </div>
    </div>
  )

  const previewPane = (
    <div
      key="preview-pane"
      style={previewPaneStyle}
      className="relative shrink-0 overflow-hidden flex flex-col h-full min-h-0 min-w-0 bg-paper"
    >
      {/* 「实时对照预览」角标已按用户口径摘除（2026-11-14）：左右两栏是什么一眼可辨，不必贴标签 */}
      {isMdPreview && zoomHud !== null && (
        <div className="pointer-events-none absolute bottom-2.5 right-3 z-10 select-none rounded border border-line/60 bg-card/85 px-2 py-0.5 text-[11px] font-semibold text-seal shadow-2xs backdrop-blur-xs">
          {zoomHud}%
        </div>
      )}
      {previewContent}
    </div>
  )

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full w-full min-h-0 flex-1 overflow-hidden select-none ${
        isVertical ? 'flex-col' : 'flex-row'
      }`}
    >
      {/* 默认**编辑在左、预览在右**（用户口径，2026-11-14 改：原先预览在左）；
          双击分割线 / :preview switch 对调成预览在左 */}
      {isSwapped ? previewPane : sourcePane}

      {/* 分割拖拽条（双击对调、鼠标拖拽调宽，全直角设计） */}
      <div
        role="separator"
        aria-orientation={isVertical ? 'horizontal' : 'vertical'}
        title={t('拖拽调整分栏大小，双击对调两列位置')}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        className={`group relative z-30 shrink-0 touch-none transition-colors select-none ${
          isVertical
            ? 'h-1.5 w-full cursor-row-resize border-y border-line/50 bg-line/20 hover:bg-seal/40'
            : 'h-full w-1.5 cursor-col-resize border-x border-line/50 bg-line/20 hover:bg-seal/40'
        }`}
      >
        <div
          className={`absolute inset-0 m-auto bg-line/80 transition-colors group-hover:bg-seal ${
            isVertical ? 'h-0.5 w-10' : 'h-10 w-0.5'
          }`}
        />
      </div>

      {isSwapped ? sourcePane : previewPane}
    </div>
  )
}

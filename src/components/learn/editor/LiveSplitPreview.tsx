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

/**
 * 实时分栏预览开关事件广播（支持 Vim :preview 冒号命令与快捷键一键唤起）
 */
type PreviewToggleListener = (forceState?: boolean) => void
const previewListeners = new Set<PreviewToggleListener>()

export function toggleEditorPreview(forceState?: boolean): void {
  for (const listener of previewListeners) {
    listener(forceState)
  }
}

export function subscribeEditorPreview(listener: PreviewToggleListener): () => void {
  previewListeners.add(listener)
  return () => {
    previewListeners.delete(listener)
  }
}

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
  if (typeof sessionStorage !== 'undefined' && key) {
    try {
      const raw = sessionStorage.getItem(`moji:split-preview:${key}`)
      if (raw) {
        const parsed = JSON.parse(raw) as PreviewState
        memoryState.set(key, parsed)
        return parsed
      }
    } catch {
      // 忽略容错
    }
  }
  // 默认打开分栏实时预览
  return { isOpen: true, splitRatio: 50, isSwapped: false }
}

function savePreviewState(key: string | undefined, state: PreviewState): void {
  if (!key) return
  memoryState.set(key, state)
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(`moji:split-preview:${key}`, JSON.stringify(state))
    } catch {
      // 忽略
    }
  }
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
 * 1. 默认打开分栏实时预览，支持点击悬浮按钮或输入 Vim :preview 命令切换；
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
  const [isSwapped, setIsSwapped] = useState(initial.isSwapped) // 是否对调两列位置

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

  // 订阅 Vim :preview 命令与全局切换广播
  useEffect(() => {
    return subscribeEditorPreview((force) => {
      setIsOpen((prev) => (force !== undefined ? force : !prev))
    })
  }, [setIsOpen])

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

  // 实时编译 Markdown 或 HTML 预览内容
  const previewContent = useMemo(() => {
    if (!isOpen) return null

    const isHtml = ext === '.html' || ext === '.htm'
    if (isHtml) {
      // 剥离外链与脚本，安全渲染
      const safeHtml = value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<link\b[^>]*\brel=["']?(?:modulepreload|preload)["']?[^>]*>/gi, '')
      return (
        <iframe
          srcDoc={safeHtml}
          title={t('HTML 实时预览')}
          sandbox="allow-same-origin"
          className="h-full w-full border-none bg-white dark:bg-card"
        />
      )
    }

    // Markdown 实时渲染：套入 note-preview moji-node-note doc-measure 完整样式体系
    const html = renderNoteGfm(value)
    return (
      <div ref={previewScrollRef} className="h-full w-full min-h-0 overflow-y-auto overflow-x-hidden">
        <div
          className="note-preview moji-node-note doc-measure relative px-7 pt-4 pb-10"
          style={{ '--doc-scale': 1 } as CSSProperties}
        >
          <MarkdownView html={html} />
        </div>
      </div>
    )
  }, [isOpen, value, ext])

  if (!isOpen) {
    return (
      <EditorCursorBindingContext.Provider value={onCursorRatio}>
        <div className="relative flex flex-col h-full w-full min-h-0 flex-1 overflow-hidden">{children}</div>
      </EditorCursorBindingContext.Provider>
    )
  }

  // 分配尺寸：对调时翻转比例
  const effectiveRatio = isSwapped ? 100 - splitRatio : splitRatio

  const sourcePaneStyle = isVertical
    ? { height: `${effectiveRatio}%`, width: '100%' }
    : { width: `${effectiveRatio}%`, height: '100%' }

  const previewPaneStyle = isVertical
    ? { height: `${100 - effectiveRatio}%`, width: '100%' }
    : { width: `${100 - effectiveRatio}%`, height: '100%' }

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
      <div className="pointer-events-none absolute right-3 top-2.5 z-10 select-none rounded border border-line/60 bg-card/85 px-2 py-0.5 text-[10px] font-medium text-seal shadow-2xs backdrop-blur-xs">
        {t('实时对照预览')}
      </div>
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

/**
 * Vim `:fixside` 固定外侧对照栏布局组件：
 * - 位于主页签树（`docs.layout`）之外，与先前的独立 AgentPanel 侧栏同处一侧宿主位；
 * - 切换、新建或关闭主区任意其他页签均不会影响固定外侧栏；
 * - 支持拖拽分割线调宽（300~960px）、双击分割线左右对调以及收起/展开，状态随 state.json 持久化。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { clampFixSideWidth, findFixSideTargetTab } from '../../../learn/groups'
import type { GroupBodyCtx } from './GroupBodyCtx'
import { SidePortalPane } from './SidePortalPane'
import { t } from '../../../i18n'

export interface FixSideLayoutProps {
  docsSlot: ReactNode
  portalCtx: GroupBodyCtx
  pure: boolean
  pureMoving: boolean
}

export function FixSideLayout({ docsSlot, portalCtx, pure, pureMoving }: FixSideLayoutProps) {
  const { store, getLatest, set } = portalCtx
  const fixSide = store.fixSide
  const targetTab = findFixSideTargetTab(store.docArea, fixSide)

  const panelRef = useRef<HTMLElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const hintRef = useRef<HTMLDivElement | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(
    () => () => {
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
    },
    [],
  )

  if (!fixSide || !targetTab) {
    return (
      <div className="print-flat relative flex min-h-0 flex-1 flex-col">
        {docsSlot}
      </div>
    )
  }

  const left = Boolean(fixSide.left)
  const collapsed = Boolean(fixSide.collapsed)
  const width = clampFixSideWidth(fixSide.width)
  const hidden = collapsed || pure

  const closeFixSide = () => {
    const cur = getLatest()
    if (!cur.fixSide) return
    const { fixSide: _removed, ...rest } = cur
    set(rest)
  }

  const swapFixSide = () => {
    const cur = getLatest()
    if (!cur.fixSide) return
    set({
      ...cur,
      fixSide: {
        ...cur.fixSide,
        left: !cur.fixSide.left,
        collapsed: false,
      },
    })
  }

  const toggleCollapse = () => {
    const cur = getLatest()
    if (!cur.fixSide) return
    set({
      ...cur,
      fixSide: {
        ...cur.fixSide,
        collapsed: !cur.fixSide.collapsed,
      },
    })
  }

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || hidden) return
    e.preventDefault()
    dragCleanupRef.current?.()

    const startX = e.clientX
    const startW = width
    let latestW = startW
    setDragging(true)

    const paintWidth = (nextW: number) => {
      const clamped = clampFixSideWidth(nextW)
      latestW = clamped
      if (panelRef.current) panelRef.current.style.width = `${clamped}px`
      if (innerRef.current) innerRef.current.style.width = `${clamped}px`
      if (hintRef.current) {
        hintRef.current.textContent = `${clamped}px`
        hintRef.current.style.visibility = 'visible'
      }
    }

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const delta = left ? dx : -dx
      paintWidth(startW + delta)
    }

    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragCleanupRef.current = null
      setDragging(false)
      if (hintRef.current) hintRef.current.style.visibility = 'hidden'
      const cur = getLatest()
      if (cur.fixSide) {
        set({ ...cur, fixSide: { ...cur.fixSide, width: latestW } })
      }
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    dragCleanupRef.current = finish
  }

  // 右侧停靠时向左折叠/右展开；左侧停靠时箭头对称
  const CollapseIcon = left
    ? collapsed
      ? ChevronRight
      : ChevronLeft
    : collapsed
      ? ChevronLeft
      : ChevronRight

  return (
    <div
      data-fix-side={left ? 'left' : 'right'}
      data-fix-side-tab={targetTab.id}
      className={
        'print-flat relative flex min-h-0 flex-1 overflow-hidden ' +
        (left ? 'flex-row-reverse ' : 'flex-row ') +
        (dragging ? 'select-none' : '')
      }
    >
      {/* 主页签布局区：DOM 首位保持不动，左右对调时不卸载内部编辑器与大纲状态 */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {docsSlot}
      </div>

      {/* 外侧分隔线与收起按钮：Zen 模式让位隐藏 */}
      {!pure && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('拖拽调整固定外侧栏宽度，双击对调左右位置')}
          title={t('拖拽调整固定外侧栏宽度，双击对调左右位置')}
          onPointerDown={beginDrag}
          onDoubleClick={(e) => {
            e.preventDefault()
            swapFixSide()
          }}
          className={
            'no-print group relative z-20 flex w-2 shrink-0 items-center justify-center transition-colors hover:bg-seal/15 ' +
            (hidden ? '-mx-1 cursor-default' : '-mx-1 cursor-col-resize')
          }
        >
          <span
            aria-hidden="true"
            className="h-full w-px bg-line/80 transition-colors group-hover:w-[2px] group-hover:bg-seal/70"
          />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapse()
            }}
            title={collapsed ? t('展开固定外侧栏') : t('收起固定外侧栏')}
            aria-label={collapsed ? t('展开固定外侧栏') : t('收起固定外侧栏')}
            className={
              'absolute top-1/2 -translate-y-1/2 z-30 flex h-8 w-5 items-center justify-center rounded-full border border-line/80 bg-paper text-ink-soft shadow-xs transition hover:border-line-strong hover:text-ink ' +
              (collapsed
                ? left
                  ? 'left-1.5'
                  : 'right-1.5'
                : 'left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100')
            }
          >
            <CollapseIcon size={12} />
          </button>

          <div
            ref={hintRef}
            style={{ visibility: 'hidden' }}
            className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-ink/90 px-2 py-0.5 text-[10.5px] font-mono tabular-nums text-paper shadow-sm whitespace-nowrap"
          />
        </div>
      )}

      {/* 固定外侧栏容器（与先前的右侧 AgentPanel 同位） */}
      <section
        ref={panelRef}
        aria-label={t('固定外侧对照栏')}
        style={{ width: hidden ? '0px' : `${width}px` }}
        className={
          'no-print relative flex min-h-0 shrink-0 flex-col bg-card ' +
          (left ? 'border-r border-line/70 ' : 'border-l border-line/70 ') +
          (dragging ? 'transition-none ' : 'transition-[width] duration-300 ease-out ') +
          (hidden || pureMoving ? 'overflow-hidden ' : '')
        }
      >
        <div
          ref={innerRef}
          style={{ width: `${width}px` }}
          className={'flex h-full min-h-0 flex-col ' + (hidden ? 'invisible' : '')}
        >
          <SidePortalPane
            ctx={portalCtx}
            targetTab={targetTab}
            mode="fixside"
            onClose={closeFixSide}
            onSwap={swapFixSide}
          />
        </div>
      </section>
    </div>
  )
}

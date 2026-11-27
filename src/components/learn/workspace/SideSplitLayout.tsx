/**
 * 页签内内置双栏布局容器（Vim :side）：
 * - 不拆分 DocGroup，也不多生成任何 Tab 栏；
 * - 始终保留 `primary` 宿主 DOM 稳定挂载，开关/对调时保活层零卸载；
 * - 支持拖拽中间分割线实时调宽（松手落盘持久化）与双击分割线对调左右位置。
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { LearnTab } from '../../../learn/types'
import {
  DEFAULT_SIDE_RATIO,
  clampSideRatio,
  setTabSidePortalRatio,
  toggleSwapTabSidePortal,
  withTabSidePortal,
} from '../../../learn/groups'
import { SidePortalPane } from './SidePortalPane'
import type { GroupBodyCtx } from './GroupBodyCtx'
import { t } from '../../../i18n'

export interface SideSplitLayoutProps {
  ctx: GroupBodyCtx
  sourceTab: LearnTab | null
  targetTab: LearnTab | null
  primary: ReactNode
}

const DIVIDER_PX = 8

export function SideSplitLayout({ ctx, sourceTab, targetTab, primary }: SideSplitLayoutProps) {
  const { getLatest, set } = ctx
  const containerRef = useRef<HTMLDivElement | null>(null)
  const primaryWrapRef = useRef<HTMLDivElement | null>(null)
  const portalWrapRef = useRef<HTMLDivElement | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const enabled = Boolean(sourceTab?.side && targetTab && targetTab.id !== sourceTab.id)
  const ratio = clampSideRatio(sourceTab?.side?.ratio ?? DEFAULT_SIDE_RATIO)
  const swapped = Boolean(sourceTab?.side?.swapped)

  useEffect(
    () => () => {
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
    },
    [],
  )

  const closePortal = () => {
    if (!sourceTab) return
    const latest = getLatest()
    set({ ...latest, docArea: withTabSidePortal(latest.docArea, sourceTab.id, null) })
  }

  const swapPortal = () => {
    if (!sourceTab) return
    const apply = () => {
      const latest = getLatest()
      set({ ...latest, docArea: toggleSwapTabSidePortal(latest.docArea, sourceTab.id) })
    }
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition
    if (typeof vt === 'function') {
      vt.call(document, () => flushSync(apply))
    } else {
      apply()
    }
  }

  const commitRatio = (nextRatio: number) => {
    if (!sourceTab) return
    const latest = getLatest()
    set({
      ...latest,
      docArea: setTabSidePortalRatio(latest.docArea, sourceTab.id, clampSideRatio(nextRatio)),
    })
  }

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || e.button !== 0) return
    const container = containerRef.current
    if (!container) return
    e.preventDefault()
    dragCleanupRef.current?.()

    let latestLeftRatio = ratio
    const applyWidth = (leftRatio: number) => {
      const clamped = clampSideRatio(leftRatio)
      latestLeftRatio = clamped
      const leftWidth = `calc(${(clamped * 100).toFixed(4)}% - ${DIVIDER_PX / 2}px)`
      const rightWidth = `calc(${((1 - clamped) * 100).toFixed(4)}% - ${DIVIDER_PX / 2}px)`
      const leftEl = swapped ? portalWrapRef.current : primaryWrapRef.current
      const rightEl = swapped ? primaryWrapRef.current : portalWrapRef.current
      if (leftEl) {
        leftEl.style.flex = '0 0 auto'
        leftEl.style.width = leftWidth
      }
      if (rightEl) {
        rightEl.style.flex = '0 0 auto'
        rightEl.style.width = rightWidth
      }
    }

    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      if (rect.width <= DIVIDER_PX) return
      const rel = (ev.clientX - rect.left) / rect.width
      applyWidth(rel)
    }

    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragCleanupRef.current = null
      commitRatio(latestLeftRatio)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    dragCleanupRef.current = finish
  }

  const primaryWidth = enabled
    ? `calc(${((swapped ? 1 - ratio : ratio) * 100).toFixed(4)}% - ${DIVIDER_PX / 2}px)`
    : undefined
  const portalWidth = enabled
    ? `calc(${((swapped ? ratio : 1 - ratio) * 100).toFixed(4)}% - ${DIVIDER_PX / 2}px)`
    : undefined

  return (
    <div
      ref={containerRef}
      data-side-split={enabled ? 'active' : undefined}
      className={'relative flex min-h-0 flex-1 overflow-hidden bg-card ' + (enabled ? 'flex-row' : 'flex-col')}
    >
      <div
        ref={primaryWrapRef}
        style={enabled ? { width: primaryWidth, flex: '0 0 auto', order: swapped ? 3 : 1 } : undefined}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {primary}
      </div>

      {enabled && targetTab && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('拖拽调整双栏宽度，双击对调左右位置')}
            title={t('拖拽调整双栏宽度，双击对调左右位置')}
            onPointerDown={beginDrag}
            onDoubleClick={(e) => {
              e.preventDefault()
              swapPortal()
            }}
            style={{ order: 2, width: `${DIVIDER_PX}px` }}
            className="group relative flex shrink-0 cursor-col-resize items-center justify-center bg-transparent transition-colors hover:bg-seal/15 select-none"
          >
            <span
              aria-hidden="true"
              className="h-full w-px bg-line/80 transition-colors group-hover:w-[2px] group-hover:bg-seal/70"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-8 w-1 rounded-full bg-line-strong/80 opacity-0 transition group-hover:opacity-100"
            />
          </div>

          <div
            ref={portalWrapRef}
            style={{ width: portalWidth, flex: '0 0 auto', order: swapped ? 1 : 3 }}
            className="relative flex min-h-0 min-w-0 flex-col overflow-hidden"
          >
            <SidePortalPane
              ctx={ctx}
              targetTab={targetTab}
              webMountedElsewhere={ctx.store.fixSide?.targetTabId === targetTab.id}
              onClose={closePortal}
              onSwap={swapPortal}
            />
          </div>
        </>
      )}
    </div>
  )
}

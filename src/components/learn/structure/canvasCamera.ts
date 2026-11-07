/**
 * 结构画布的镜头 hook：视口测量（ResizeObserver）、相机状态（x/y/zoom）与 RAF 批量
 * 调度（滚轮高频更新合并到每一帧）、动画跳转（300ms transition 滑过去）、适应画布、
 * 聚焦卡片、双击阅读位、focusTarget 路由、滚轮缩放/平移、屏幕↔世界坐标换算。
 * 相机是**固定的**正交投影（不开 perspective），指针换算只是乘法。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { HeightOf } from '../../../learn/structure'
import { boundsOf, cardWidthOf, centerPan, clampZoom, fitZoom } from '../../../learn/structure'
import { outlineUuid } from '../../../learn/nodeKinds'
import { FOCUS_VERTICAL, FOCUS_ZOOM } from './canvasTypes'
import type { CardView } from './structureView'

/** 镜头 hook 需要的宿主能力与共享状态 */
export interface CanvasCameraDeps {
  containerRef: RefObject<HTMLDivElement | null>
  planeRef: RefObject<HTMLDivElement | null>
  trashRef: RefObject<HTMLDivElement | null>
  goalId: string
  cards: CardView[]
  height: HeightOf
  /** 节点总包围盒（null = 画布上还没有卡） */
  bounds: { x: number; y: number; width: number; height: number } | null
  /** 外部指定的聚焦目标（chip 路由）：把镜头挪到 uuid 对得上的那张卡 */
  focusTarget?: { nodeId: string; nonce: number } | null
  onFocusHandled?: () => void
  /** 跳转后闪一下的那张卡（900ms 后清掉），状态在宿主 */
  setFlashId: Dispatch<SetStateAction<string | null>>
  setSelectedId: Dispatch<SetStateAction<string | null>>
  setMultiIds: Dispatch<SetStateAction<Set<string> | null>>
  /** 下一次 cards 变了之后要不要自动对镜头（自动排列之后用），宿主写入 */
  fitNextRef: RefObject<boolean>
}

export function useCanvasCamera({
  containerRef,
  planeRef,
  trashRef,
  goalId,
  cards,
  height,
  bounds,
  focusTarget,
  onFocusHandled,
  setFlashId,
  setSelectedId,
  setMultiIds,
  fitNextRef,
}: CanvasCameraDeps) {

  const [view, setView] = useState({ width: 0, height: 0 })
  const [camera, setCamera] = useState({ x: 72, y: 72, zoom: 1 })
  const cameraRef = useRef(camera)
  const setCameraSync = useCallback((next: { x: number; y: number; zoom: number }) => {
    cameraRef.current = next
    setCamera(next)
  }, [])
  const pendingCameraRef = useRef<{ x: number; y: number; zoom: number } | null>(null)
  const wheelRafRef = useRef<number | null>(null)
  /**
   * RAF 批量合并相机更新（滚轮缩放/平移防卡顿）：
   * 高频滚轮/手势事件累积到 pendingCameraRef 中，每一帧 VSync 最多触发一次 React 渲染，
   * 彻底避免一帧内几十次 React 重排导致的掉帧卡顿。
   */
  const scheduleCameraUpdate = useCallback((nextCam: { x: number; y: number; zoom: number }) => {
    pendingCameraRef.current = nextCam
    cameraRef.current = nextCam
    if (wheelRafRef.current == null) {
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null
        if (pendingCameraRef.current) {
          const next = pendingCameraRef.current
          pendingCameraRef.current = null
          setCamera(next)
        }
      })
    }
  }, [])

  const flushPendingCamera = useCallback(() => {
    if (wheelRafRef.current != null) {
      cancelAnimationFrame(wheelRafRef.current)
      wheelRafRef.current = null
    }
    if (pendingCameraRef.current) {
      const next = pendingCameraRef.current
      pendingCameraRef.current = null
      setCameraSync(next)
    }
  }, [setCameraSync])

  useEffect(() => {
    return () => {
      if (wheelRafRef.current != null) {
        cancelAnimationFrame(wheelRafRef.current)
      }
    }
  }, [])
  /** 镜头正在做过渡（这段时间平面带 transition，跳转才是「滑过去」而不是瞬移） */
  const [animating, setAnimating] = useState(false)
  const animTimer = useRef<number | null>(null)
  const flashTimer = useRef<number | null>(null)
  const fittedRef = useRef(false)
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  const viewRef = useRef(view)
  viewRef.current = view
  const heightRef = useRef(height)
  heightRef.current = height
  /* ---------- 视口尺寸（缩放的下限要靠它算） ---------- */

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setView((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])
  /* ---------- 镜头 ---------- */

  /**
   * 镜头跳转：**滑过去**而不是瞬移。
   *
   * 做法是给平面挂 300ms 的 transition-transform，跳完再摘掉——一直挂着的话，
   * 手动拖动与滚轮也会变成「带惯性的慢半拍」，那是另一种难受。
   */
  const animateCamera = useCallback((next: { x: number; y: number; zoom: number }) => {
    cameraRef.current = next
    if (wheelRafRef.current != null) {
      cancelAnimationFrame(wheelRafRef.current)
      wheelRafRef.current = null
      pendingCameraRef.current = null
    }
    setAnimating(true)
    setCamera(next)
    if (animTimer.current !== null) window.clearTimeout(animTimer.current)
    animTimer.current = window.setTimeout(() => {
      animTimer.current = null
      setAnimating(false)
    }, 320)
  }, [])

  const fit = useCallback(() => {
    const box = boundsOf(cards, height)
    if (!box || !view.width || !view.height) return
    const zoom = fitZoom(box, view)
    animateCamera({ ...centerPan(box, view, zoom), zoom })
  }, [cards, height, view, animateCamera])

  useEffect(() => {
    fittedRef.current = false
  }, [goalId])

  useEffect(() => {
    if (fitNextRef.current) {
      fitNextRef.current = false
      fit()
      return
    }
    if (fittedRef.current) return
    if (!view.width || !bounds) return
    fittedRef.current = true
    fit()
  }, [view.width, bounds, fit, fitNextRef])

  /** 闪一下边框：跳转之后告诉用户「你被带到这儿了」 */
  const flash = useCallback((id: string) => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    setFlashId(id)
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null
      setFlashId(null)
    }, 900)
  }, [setFlashId])
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    },
    [],
  )
  useEffect(
    () => () => {
      if (animTimer.current !== null) window.clearTimeout(animTimer.current)
    },
    [],
  )

  const centerOn = useCallback(
    (id: string) => {
      const card = cards.find((c) => c.uuid === id)
      if (!card || !view.width) return
      const zoom = Math.max(cameraRef.current.zoom, 1)
      animateCamera({
        ...centerPan({ x: card.x, y: card.y, width: cardWidthOf(card.kind), height: height(card) }, view, zoom),
        zoom,
      })
      setSelectedId(id)
      flash(id)
    },
    [cards, view, height, flash, animateCamera, setSelectedId],
  )

  /**
   * 双击节点：把它带到一个**固定**的阅读位——垂直 40%、水平居中、放大 140%。
   * 走 animateCamera 的过渡（300ms ease-out），是滑过去不是闪过去。
   */
  const focusCard = useCallback(
    (card: CardView) => {
      if (!view.width || !view.height) return
      animateCamera({
        x: view.width / 2 - (card.x + cardWidthOf(card.kind) / 2) * FOCUS_ZOOM,
        y: view.height * FOCUS_VERTICAL - (card.y + height(card) / 2) * FOCUS_ZOOM,
        zoom: FOCUS_ZOOM,
      })
      setSelectedId(card.uuid)
      setMultiIds(null)
      flash(card.uuid)
    },
    [view, height, animateCamera, flash, setSelectedId, setMultiIds],
  )

  const lastFocusNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!focusTarget || focusTarget.nonce === lastFocusNonce.current) return
    lastFocusNonce.current = focusTarget.nonce
    const target = cards.find((c) => c.uuid === outlineUuid(focusTarget.nodeId)) ?? cards.find((c) => c.uuid === focusTarget.nodeId)
    if (target && view.width) {
      const zoom = Math.max(cameraRef.current.zoom, 1)
      animateCamera({ ...centerPan({ x: target.x, y: target.y, width: cardWidthOf(target.kind), height: height(target) }, view, zoom), zoom })
      setSelectedId(target.uuid)
      flash(target.uuid)
    }
    onFocusHandled?.()
  }, [focusTarget, cards, view, height, onFocusHandled, flash, animateCamera, setSelectedId])

  /* ---------- 滚轮：平移为主，Ctrl/⌘ + 滚轮缩放（RAF 批量调度防卡顿，连续平滑缩放） ---------- */

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = cameraRef.current
      if (animTimer.current !== null) {
        window.clearTimeout(animTimer.current)
        animTimer.current = null
      }
      if (planeRef.current) {
        planeRef.current.style.transition = 'none'
      }
      setAnimating(false)

      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        const normDelta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY
        const clampedDelta = Math.max(-120, Math.min(120, normDelta))
        const factor = Math.exp(-clampedDelta * 0.0018)
        const next = clampZoom(cam.zoom * factor, boundsRef.current, viewRef.current)
        if (next === cam.zoom) return
        const k = next / cam.zoom
        scheduleCameraUpdate({ x: px - (px - cam.x) * k, y: py - (py - cam.y) * k, zoom: next })
        return
      }
      // Shift + 滚轮：横向滚动（触控板横滑本来就给 deltaX，两种都给上）
      const rawDx = e.shiftKey ? e.deltaY : e.deltaX
      const rawDy = e.shiftKey ? 0 : e.deltaY
      if (rawDx === 0 && rawDy === 0) return
      scheduleCameraUpdate({ ...cam, x: cam.x - rawDx, y: cam.y - rawDy })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scheduleCameraUpdate, containerRef, planeRef])

  /* ---------- 坐标换算（正交投影：y 除以 cos 就把倾斜还原了） ---------- */

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    const cam = cameraRef.current
    const rect = el?.getBoundingClientRect()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0
    return {
      x: (clientX - left - cam.x) / cam.zoom,
      y: (clientY - top - cam.y) / cam.zoom,
    }
  }, [containerRef])

  const isOverTrash = useCallback((clientX: number, clientY: number) => {
    const rect = trashRef.current?.getBoundingClientRect()
    if (!rect) return false
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }, [trashRef])
  return {
    view,
    camera,
    cameraRef,
    boundsRef,
    viewRef,
    animating,
    setAnimating,
    setCameraSync,
    scheduleCameraUpdate,
    flushPendingCamera,
    animTimer,
    fit,
    centerOn,
    focusCard,
    toWorld,
    isOverTrash,
  }
}

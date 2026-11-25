/**
 * 消息气泡的右键菜单：一份 portal 菜单，位置跟着鼠标，越界时自动翻回视口内。
 *
 * 为什么是 portal：消息列表在滚动容器里，菜单若留在气泡子树里会被 overflow 裁掉；
 * 挂到 body 上才能贴着指针出现，也不受任何祖先 transform / mask 影响。
 *
 * 只管「有哪些项、点了谁」；复制与评论由调用方决定（消息层认识消息，菜单不认识）。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../../i18n'

export interface MessageMenuItem {
  key: string
  label: string
  icon: ReactNode
  onSelect: () => void
}

/** 菜单与视口边缘留的缝 */
const EDGE = 8

export function MessageContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MessageMenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // 量完实际尺寸再夹回视口：右边 / 下边放不下就朝反方向翻，layout effect 里改，
  // 提交后、绘制前完成，不会先闪一下再跳。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const maxLeft = Math.max(EDGE, window.innerWidth - w - EDGE)
    const maxTop = Math.max(EDGE, window.innerHeight - h - EDGE)
    setPos({ left: Math.min(Math.max(EDGE, x), maxLeft), top: Math.min(Math.max(EDGE, y), maxTop) })
  }, [x, y, items.length])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // 捕获阶段收：列表一滚、窗口一缩，菜单就离开原位了，直接收掉
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t('消息操作')}
      style={{ left: pos.left, top: pos.top }}
      className="moji-bloom-up-in fixed z-[80] min-w-[128px] overflow-hidden rounded-xl border border-line-strong bg-card/95 p-1 shadow-[0_16px_48px_rgba(0,0,0,0.22)] backdrop-blur-xl"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation()
            item.onSelect()
            onClose()
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-ink-soft transition-colors hover:bg-seal/10 hover:text-ink"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint">{item.icon}</span>
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}

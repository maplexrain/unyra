/**
 * 浮层外壳的两件小事：**什么时候收起来**、**收在哪儿**。
 *
 * 页签右键菜单（components/learn/TabBar 里的 TabMenu）与资源管理器右键菜单
 * （components/learn/explorer/RowMenu）把这两段逐字抄了两遍——连夹取时那个 8px
 * 的余量、连依赖口径都一样。抄两遍的代价不在篇幅，而在**改一处忘一处**：
 * 「视图一动就收起」「菜单不许被视口切掉」是这两张菜单共同的规矩，
 * 只守一半比两处都不守更难看出来。
 *
 * 默认值与那两处的现状一字不差：四类信号全开。scroll 挂在**捕获**阶段，
 * 是因为菜单可能开在任意滚动容器里——滚的是谁不重要，视图动了就算。
 */

import { useEffect, useLayoutEffect, type RefObject } from 'react'

/** 收起信号的开关。四项默认全开——原先那两处就是四类信号都收 */
export interface DismissOptions {
  /** 收起。引用一变就重挂监听（与原先那两处的依赖口径一致） */
  onClose: () => void
  /** 点别处（document 的 mousedown） */
  mousedown?: boolean
  /** 滚动（window 捕获阶段） */
  scroll?: boolean
  /** 窗口缩放 */
  resize?: boolean
  /** Esc（window 的 keydown） */
  escape?: boolean
}

/**
 * 点别处 / 滚动 / 缩放 / Esc 就收起：菜单是「此刻对着这个东西」的浮层，
 * 视图一动它指的就不再是原来那个东西了。
 *
 * 收在 **mousedown** 上而不是 click：右键菜单由 contextmenu 打开，
 * 而 contextmenu 之前必定先有一次 mousedown。于是「在别处右键」= 先关旧的、
 * 再由那一行的 contextmenu 开新的，不会出现「新菜单刚挂上就被自己关掉」。
 */
export function useDismissOn({
  onClose,
  mousedown = true,
  scroll = true,
  resize = true,
  escape = true,
}: DismissOptions): void {
  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (mousedown) document.addEventListener('mousedown', close)
    if (scroll) window.addEventListener('scroll', close, true)
    if (resize) window.addEventListener('resize', close)
    if (escape) window.addEventListener('keydown', onKey)
    return () => {
      if (mousedown) document.removeEventListener('mousedown', close)
      if (scroll) window.removeEventListener('scroll', close, true)
      if (resize) window.removeEventListener('resize', close)
      if (escape) window.removeEventListener('keydown', onKey)
    }
  }, [onClose, mousedown, scroll, resize, escape])
}

/**
 * 把浮层夹进视口：先按「右下边缘留 8px 余量」夹一次，再兜住左上角不许越过 8px。
 * 两步缺一不可——只夹右边，窄窗口下菜单会被推到屏幕外；只夹左边，贴边那一半看不见。
 *
 * 用 useLayoutEffect 而不是 useEffect：位置要在浏览器绘制**之前**定下来，
 * 否则菜单会先在指针底下闪一帧、再跳到夹取后的地方。
 *
 * menu 给 null 时不摆（调用方此时通常还没渲染出菜单本体）。
 * 依赖按 menu 的对象身份走：调用方换一个坐标就是换一个对象，与原先两处的口径一致。
 */
export function useClampToViewport(
  ref: RefObject<HTMLElement | null>,
  menu: { x: number; y: number } | null,
): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !menu) return
    const left = Math.min(menu.x, window.innerWidth - el.offsetWidth - 8)
    const top = Math.min(menu.y, window.innerHeight - el.offsetHeight - 8)
    el.style.left = Math.max(8, left) + 'px'
    el.style.top = Math.max(8, top) + 'px'
  }, [ref, menu])
}

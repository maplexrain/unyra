/*
 * 本文件负责：节点卡片的**统一外观**——class 基底、color-mix 调色、按分支色/状态色
 * 推导整张卡片的着色方案，以及「当前是不是深色」的媒体查询 hook（卡片色值按主题给）。
 *
 * 全部原样搬自 MindmapView.tsx，注释一并带走。放 .ts 而不是组件文件：
 * 组件文件不导出非组件（oxlint 的 react/only-export-components）。
 */
import { useEffect, useState } from 'react'

/**
 * 节点卡片的统一外观常量。
 *
 * 「统一各级节点的样式」落到这里：一张卡片长什么样，全图只有这一处定义，
 * 根节点不另外写一套。
 *
 * 圆角收小到 rounded-xl（原先是 rounded-2xl）：卡片是**结构单元**，不是按钮，
 * 圆角越小越像一张「卡」而不像一颗药丸；下面那个气泡 tip 再小一档（rounded-lg），
 * 两级圆角形成一档递进，气泡看着才是从卡片里长出来的。
 *
 * 颜色不进 class，进 inline style：每张卡片的边框 / 底色 / 辉光都按**自己的
 * 分支色**现场调（color-mix），这样同一支的卡片、连线、色点共享一个色相，
 * 整张图一眼就能分出「这是几支路线」。灰卡片 + 一条细色边那套在深色底下
 * 会糊成一片，所以颜色必须铺满整张卡片。
 */
export const CARD_BASE =
  'group/card absolute cursor-pointer overflow-visible rounded-xl backdrop-blur-md moji-node-sprout transition-[left,top,box-shadow,transform] duration-300 ease-[cubic-bezier(0.2,0,0,1)]'

/** 按比例把某个颜色混进透明 / 卡片底色（CSS color-mix，运行时按主题解析） */
export function mix(color: string, pct: number, base = 'transparent'): string {
  return `color-mix(in srgb, ${color} ${pct}%, ${base})`
}

/** 一张卡片的着色方案：边框色 / 底色 / 辉光，全部由分支色（或状态色）推导 */
export function cardSkin(opts: {
  accent: string
  isRoot: boolean
  isUncreated: boolean
  isMastered: boolean
  isDark: boolean
}): { borderColor: string; background: string; glow: string } {
  const { accent, isRoot, isUncreated, isMastered, isDark } = opts
  const surface = 'var(--color-card)'
  if (isUncreated) {
    // 还只是计划：虚线边 + 一点点分支色薄涂，存在感刻意压低
    return {
      borderColor: mix(accent, isDark ? 38 : 32),
      background: mix(accent, isDark ? 6 : 4, surface),
      glow: 'none',
    }
  }
  if (isMastered) {
    // 已掌握换状态绿，不再随分支色
    return {
      borderColor: mix('var(--color-ok)', isDark ? 55 : 48),
      background: mix('var(--color-ok)', isDark ? 10 : 6, surface),
      glow: `0 2px 14px ${mix('var(--color-ok)', isDark ? 22 : 14)}`,
    }
  }
  if (isRoot) {
    // 根节点用印记色（seal），着色最重一档：整张图的锚点
    return {
      borderColor: mix(accent, isDark ? 60 : 50),
      background: mix(accent, isDark ? 14 : 9, surface),
      glow: `0 4px 18px ${mix(accent, isDark ? 28 : 16)}`,
    }
  }
  return {
    borderColor: mix(accent, isDark ? 45 : 36),
    background: mix(accent, isDark ? 9 : 6, surface),
    glow: `0 2px 14px ${mix(accent, isDark ? 20 : 12)}`,
  }
}

/**
 * 当前是不是深色。用 `prefers-color-scheme` 而不是读 `data-theme`：
 * 主题块有八套，只有 `dark` 那一套需要另一组色值，其余五套浅色用 light 值即可——
 * 而 `data-theme=dark` 与系统偏好是一致的（见 lib/appearance）。
 */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

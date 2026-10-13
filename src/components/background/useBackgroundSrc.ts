/**
 * 本文件负责：把一组背景图地址解析成能直接用的 src（见 user/background 的说明）。
 *
 * 为什么是一个 hook 而不是各自在组件里写一遍：`asset:` 要读盘、`preset:` 是查常量、
 * 外链是原样——三种形态的收口在 resolveBackgroundSrc 一处，而「读回来之前先不显示」
 * 这件事两个组件都要做（GlobalBackground 铺满全屏、AppearancePanel 画缩略图）。
 *
 * 两处刻意的写法：
 * - 依赖用一个**拼起来的字符串**而不是数组：数组每次渲染都是新身份，直接放进依赖
 *   会让这个 effect 每帧重跑一遍（读盘读疯了）；
 * - 结果连同「它是哪一组地址算出来的」一起存（与 UserAvatar 同一套）：这样「换了图
 *   就先用不出旧的」是一条纯判断，不必在 effect 里同步 setState 清空一次。
 */
import { useEffect, useState } from 'react'
import { resolveBackgroundSrc } from '../../user/background'

/** 分隔符取一个正常地址里不会出现的控制字符，免得两个地址被拼成一个 */
const SEP = '\u0001'

const EMPTY: Record<string, string> = {}

/**
 * 传入一组地址，回一张「地址 → 可直接用的 src」的表。
 * 解析不出来的（文件被删了、地址不合法）不出现在结果里——调用方据此跳过这张。
 */
export function useBackgroundSrcs(urls: string[]): Record<string, string> {
  const key = urls.filter(Boolean).join(SEP)
  const [resolved, setResolved] = useState<{ key: string; map: Record<string, string> }>({
    key: '',
    map: EMPTY,
  })

  useEffect(() => {
    const list = key ? key.split(SEP) : []
    if (!list.length) return
    let alive = true
    void Promise.all(
      list.map(async (url) => [url, await resolveBackgroundSrc(url)] as const),
    ).then((pairs) => {
      if (!alive) return
      const map: Record<string, string> = {}
      for (const [url, src] of pairs) if (src) map[url] = src
      setResolved({ key, map })
    })
    return () => {
      alive = false
    }
  }, [key])

  // 只认当前这一组地址算出来的那份；还没读回来时按「还没有」处理
  return resolved.key === key ? resolved.map : EMPTY
}

/** 只要一个地址时用它（少包一层数组） */
export function useBackgroundSrc(url: string): string | null {
  const map = useBackgroundSrcs([url])
  return url ? (map[url] ?? null) : null
}

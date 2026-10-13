/**
 * 本文件负责：页签栏里一枚页签的**进出场**——新开的那枚浮出来、关掉的那枚收拢淡出。
 *
 * 为什么单独一个文件：文档区（TabBar）与超级导师栏（AgentTabStrip）两处页签栏都要这一套，
 * 而它又是纯渲染层的活（不碰任何业务数据）——放在这里两边共用一份，
 * 免得「文档区有动画、导师栏没有」这种只改了一边的漏账。
 *
 * 为什么非得有个 hook：React 一旦把节点卸载，那个 DOM 就没了，CSS 的退场动画根本没机会跑。
 * 所以关掉的那几枚要**被按住一会儿**（leaving），等退场画完才真的放走。
 *
 * 手法：**栏上画的是 hook 自己那份列表，不是 props 那份**。props 里少了一枚时，
 * 栏上这一枚还在（列表由 state 掌着），DOM 节点从来没被卸载过——下一帧才给它挂上退场的
 * class，CSS 补间的起点「上一个计算值」就是它此刻正常的样子。若在渲染里直接拿 props 的
 * 列表去重放，那一枚会在同一帧里消失，动画无处可补。
 */
import { useEffect, useRef, useState } from 'react'

/** 退场时长（毫秒）：与 workspace.css 里 .moji-tab-out 那段 transition 是一对，改一处要改两处 */
export const TAB_EXIT_MS = 160

/** 一枚页签此刻的进出场状态（顺序即栏上的顺序，含正在退场的那几枚） */
export interface TabPresence<T> {
  key: string
  item: T
  /** 已经不在列表里了，此刻只是还没放走 */
  leaving: boolean
  /** 退场动画已经开始了（比 leaving 晚一帧，见文件头的手法） */
  exiting: boolean
  /** 刚刚开出来的（入场动画只给这一枚） */
  entering: boolean
}

/** 内部那份：多一个「什么时候放走」 */
interface Row<T> extends TabPresence<T> {
  deadline: number
}

/**
 * 把一份页签列表加上进出场标记，返回**该画在栏上的那一份**。
 *
 * `keyOf` 请传**稳定的**函数（模块级函数或 useCallback）：它只用来认「哪一枚是哪一枚」，
 * 每次渲染换一个函数不会出错，但会白白多跑一轮比对。
 */
export function useTabPresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  ms: number = TAB_EXIT_MS,
): Array<TabPresence<T>> {
  /** 名单指纹：页签的增删与换序都反映在它上面，「只是重渲染」则不变 */
  const signature = items.map(keyOf).join('\u0001')
  /** 上一轮见过的名单（认「变没变」；ref 只在 effect 里读写） */
  const seen = useRef(signature)
  /**
   * 栏上此刻画着的（含正在退场的）。
   * 首帧直接铺 props 那一版：开天辟地这一次谁都不算「新开」，不然一进界面整排页签飘一遍。
   */
  const [rows, setRows] = useState<Array<Row<T>>>(() =>
    items.map((item) => ({ key: keyOf(item), item, leaving: false, exiting: false, entering: false, deadline: 0 })),
  )

  /*
   * 把 props 的名单并进栏上这份：新开的标 entering、消失的按成 leaving、留下的换上新对象。
   *
   * `items` 每次渲染都可能是新数组（文档区那一栏就是现算的），所以这一轮每渲染都跑；
   * 末尾的 sameRows 兜住「其实没变」的情况——还回原对象 React 就不再渲染一轮，
   * 于是这里不会变成死循环。
   */
  useEffect(() => {
    setRows((cur) => {
      const changed = seen.current !== signature
      seen.current = signature
      const live = new Set(items.map(keyOf))
      const had = new Map(cur.map((r) => [r.key, r] as const))
      // 活着的按 props 的顺序铺（拖动换序因此照旧生效）
      const out: Array<Row<T>> = items.map((item) => {
        const key = keyOf(item)
        const old = had.get(key)
        if (!old || old.leaving) {
          // 新开的（或退场途中又被打开了的）：入场动画从挂载那一刻起
          return { key, item, leaving: false, exiting: false, entering: true, deadline: 0 }
        }
        /*
         * entering 只在**名单真的变了**的下一轮才摘掉：
         * 那个 class 一摘动画当场中止（animation 跟着 class 走），而重渲染随时都在发生。
         */
        const entering = changed ? false : old.entering
        return old.item === item && old.entering === entering ? old : { ...old, item, entering }
      })
      /*
       * 消失的那几枚按它们**原来的下标**插回去：它在哪儿消失，邻居就从哪儿合过来。
       * 同时有退场与换序时这个下标是近似的——那一瞬间栏上本来就在重排，差一格看不出来。
       */
      for (const r of cur) {
        if (live.has(r.key)) continue
        const at = cur.findIndex((x) => x.key === r.key)
        const held = r.leaving
          ? r
          : { ...r, leaving: true, exiting: false, entering: false, deadline: Date.now() + ms }
        out.splice(Math.min(at, out.length), 0, held)
      }
      return sameRows(cur, out) ? cur : out
    })
  }, [items, keyOf, signature, ms])

  /*
   * 退场那一批的推进：下一帧打开 exiting（补间的起点是「上一帧正常的样子」），到点之后真的放走。
   * 两个 setState 都带着「没变就还回原对象」的闸，因此这里不会自己把自己转起来。
   */
  useEffect(() => {
    const leaving = rows.filter((r) => r.leaving)
    if (!leaving.length) return
    const raf = requestAnimationFrame(() =>
      setRows((cur) =>
        cur.some((r) => r.leaving && !r.exiting)
          ? cur.map((r) => (r.leaving && !r.exiting ? { ...r, exiting: true } : r))
          : cur,
      ),
    )
    const due = Math.max(...leaving.map((r) => r.deadline))
    const timer = window.setTimeout(
      () => {
        const now = Date.now()
        setRows((cur) =>
          cur.some((r) => r.leaving && r.deadline <= now)
            ? cur.filter((r) => !r.leaving || r.deadline > now)
            : cur,
        )
      },
      Math.max(0, due - Date.now()) + 40,
    )
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [rows])

  return rows
}

/** 两行列表是不是一模一样（逐字段比）：一样就还回原对象，让 React 少渲染一轮 */
function sameRows<T>(a: Array<Row<T>>, b: Array<Row<T>>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.key !== y.key ||
      x.item !== y.item ||
      x.leaving !== y.leaving ||
      x.exiting !== y.exiting ||
      x.entering !== y.entering ||
      x.deadline !== y.deadline
    ) {
      return false
    }
  }
  return true
}

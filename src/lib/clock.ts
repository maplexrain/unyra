/**
 * 界面上的「时钟」：一个随真实时间往前走的快照。
 *
 * 为什么不用 useState + setInterval：那会在渲染期读 Date.now()（React 的纯粹性规则
 * 明令禁止，本项目的 lint 也会拦），而且定时器与组件的生命周期要靠 effect 手工对齐。
 * useSyncExternalStore 正好是为「外部世界的快照」准备的：读快照是它的正经用法，
 * 而且**只有订阅了的那一小块子树会重渲染**——顶栏的时钟与倒计时因此不会把
 * 正文与对话栏一起带上（那才是每秒重渲染真正贵的地方）。
 *
 * 两条踩过的坑（都是「Maximum update depth exceeded」的成因，别再写回去）：
 *
 * 1. **subscribe 的引用必须稳定**（下面用 useCallback 记住）。React 把 subscribe 的
 *    身份当依赖：每次渲染换一个新函数，它就会退订再订一次——而重订阅会触发一次
 *    重渲染，于是「渲染 → 换身份 → 重订阅 → 重渲染」自己转起来，直到 React 报错。
 * 2. **不要在 subscribe 里调 onChange**。React 订阅完会自己读一次快照并与本次渲染
 *    用的值比对，变了就重渲染一次——它已经做了这件事，我们再推一把就是多余的提醒，
 *    配合第 1 条正好把循环点燃。
 *
 * 状态读写都收在模块函数里（不写成 hook 里的局部变量）：React 编译器会盯着
 * 「渲染期造出来的对象在渲染之后被改动」。
 */
import { useCallback, useSyncExternalStore } from 'react'

interface Clock {
  value: number
  timer: number | null
  listeners: Set<() => void>
}

const clocks = new Map<number, Clock>()

/**
 * 模块加载的那一刻：订阅回调还没跑之前，快照拿它兜底。
 *
 * 不这么兜的话首帧会读到 0（= 1970 年），日历会先闪一屏空格子再跳到今天。
 * 它比真实时间旧不了多少——工作区一挂载就订阅上了，而订阅的那一刻会对表。
 */
const LOADED_AT = Date.now()

function clockAt(stepMs: number): Clock {
  const found = clocks.get(stepMs)
  if (found) return found
  const created: Clock = { value: 0, timer: null, listeners: new Set() }
  clocks.set(stepMs, created)
  return created
}

/** 订阅：顺手对一次表（中间隔了几分钟没人看，重新订阅的那一刻就该是准的） */
function subscribeClock(stepMs: number, onChange: () => void): () => void {
  const clock = clockAt(stepMs)
  clock.listeners.add(onChange)
  if (clock.timer === null) {
    clock.value = Date.now()
    clock.timer = window.setInterval(() => {
      clock.value = Date.now()
      for (const listener of clock.listeners) listener()
    }, stepMs)
  }
  return () => {
    clock.listeners.delete(onChange)
    if (!clock.listeners.size && clock.timer !== null) {
      window.clearInterval(clock.timer)
      clock.timer = null
    }
  }
}

function readClock(stepMs: number): number {
  const clock = clocks.get(stepMs)
  return clock && clock.value ? clock.value : LOADED_AT
}

/** 当前时间（毫秒），每 stepMs 变一次；组件卸载后没有订阅者时定时器自动停掉 */
export function useClock(stepMs: number): number {
  // subscribe 必须记住：每次渲染都换一个新函数会让 React 反复退订重订，进而把渲染绕成死循环
  const subscribe = useCallback((onChange: () => void) => subscribeClock(stepMs, onChange), [stepMs])
  return useSyncExternalStore(subscribe, () => readClock(stepMs))
}

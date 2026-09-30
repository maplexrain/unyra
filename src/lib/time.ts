/**
 * 「刚刚 / N 分钟前 / 昨天 / 8 月 12 日」。
 *
 * now 由调用方给：组件在渲染期读 Date.now() 是 React 的纯粹性规则明令禁止的，
 * 要用它就得把时钟从外面递进来（见 lib/clock 的 useClock）。省略则是普通函数调用。
 *
 * 文案在这里包 t() 并参数化：调用方（最近打开列表）直接显示返回值，不在显示侧再包一层。
 */
import { t } from '../i18n'

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = now - ts
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000
  if (diff < minute) return t('刚刚')
  if (diff < hour) return t('{0} 分钟前', Math.floor(diff / minute))
  if (diff < day) return t('{0} 小时前', Math.floor(diff / hour))
  if (diff < 2 * day) return t('昨天')
  const d = new Date(ts)
  if (d.getFullYear() === new Date(now).getFullYear()) {
    return t('{0} 月 {1} 日', d.getMonth() + 1, d.getDate())
  }
  return t('{0} 年 {1} 月 {2} 日', d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/**
 * 两位补零：`9` → `09`。
 *
 * 提出来导出的理由：这件事原本散在几个模块里各写了一遍（学习日、
 * 试卷副本、这个时钟），四处连名字都不一样（pad / p / pad2）。补零看着无关紧要，
 * 但一份日期里少一位就是另一个日子，口径只能有一处。**只补零**：
 * 不做本地化、不认负数（取值范围由调用方自己保证）。
 */
export const pad2 = (n: number): string => String(n).padStart(2, '0')

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

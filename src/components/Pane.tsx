/**
 * 这个模块为什么存在：设置类面板的滚动外壳类名（min-h-0 / flex-1 / flex-col / gap-N /
 * overflow-y-auto / px-5 py-4）在十个文件里写了十五遍，抽在这里。
 *
 * 两处差异是参数，不许一刀切：
 * - gap：原本分 gap-3 / gap-4 / gap-5 三档，按各自的原值传；
 * - text：末尾的 text-[13px] text-ink 原本十处带、五处不带，按各自的原样传。
 *
 * 只拼类名、不包 DOM：调用点仍是原来那个 div，标签层级与合并前一字不差。
 */

/** Tailwind 只认源码里出现过的字面量，所以三档 gap 在这里各写一遍，不做模板拼接 */
const GAP = {
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
} as const

const TEXT = ' text-[13px] text-ink'

/** 面板外壳类名：gap 是档位（3 / 4 / 5），text 决定末尾要不要那对字号 / 颜色类名 */
export function pane(gap: 3 | 4 | 5, text = false): string {
  return `flex min-h-0 flex-1 flex-col ${GAP[gap]} overflow-y-auto px-5 py-4${text ? TEXT : ''}`
}

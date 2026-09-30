/**
 * 数值小工具：把外部来的值收成能参与运算的数字。
 *
 * 两份都来自「翻译网关用量」这条线：网关回的 token 数可能是字符串、null、
 * 或者压根没有这个字段，三家的解析代码各抄了一份逐字相同的实现，于是收在这里。
 * 共用的意义在口径：**取不到就是 0**，不是 NaN、不是 undefined——上层据此相加、
 * 算命中率、画圆环，多一处不同的兜底就会多一处 NaN。
 */

/** 取有限数；拿不到（缺字段、字符串、NaN、Infinity）一律 0 */
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** 夹到 [lo, hi] 区间 */
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

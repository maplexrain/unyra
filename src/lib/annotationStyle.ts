import type { AnnotationStyle } from '../learn/types'

/**
 * 注解文字的样式调色板与内联样式生成。
 *
 * 颜色只存 key（如 'seal'）在数据里，渲染时映射成主题 CSS 变量：
 * 深色模式自动跟着变，也不会把任意 CSS 注入数据。前景色与背景色共用同一组 key。
 */

export interface AnnoColor {
  key: string
  label: string
  /** 前景色 */
  fg: string
  /** 背景色：低透明度底色，避免盖住正文 */
  bg: string
}

export const ANNO_COLORS: AnnoColor[] = [
  {
    key: 'seal',
    label: '印章红',
    fg: 'var(--color-seal-deep)',
    bg: 'color-mix(in srgb, var(--color-seal) 18%, transparent)',
  },
  {
    key: 'ink',
    label: '墨色',
    fg: 'var(--color-ink-strong)',
    bg: 'color-mix(in srgb, var(--color-ink) 14%, transparent)',
  },
  {
    key: 'ok',
    label: '苔绿',
    fg: 'var(--color-ok-text)',
    bg: 'color-mix(in srgb, var(--color-ok) 26%, transparent)',
  },
  {
    key: 'warn',
    label: '赭黄',
    fg: 'var(--color-warn-deep)',
    bg: 'color-mix(in srgb, var(--color-warn) 28%, transparent)',
  },
  {
    key: 'blue',
    label: '靛蓝',
    fg: 'var(--color-anno-blue)',
    bg: 'color-mix(in srgb, var(--color-anno-blue) 18%, transparent)',
  },
  {
    key: 'purple',
    label: '紫',
    fg: 'var(--color-anno-purple)',
    bg: 'color-mix(in srgb, var(--color-anno-purple) 20%, transparent)',
  },
]

export const ANNO_COLOR_KEYS = new Set(ANNO_COLORS.map((c) => c.key))

const FG = new Map(ANNO_COLORS.map((c) => [c.key, c.fg]))
const BG = new Map(ANNO_COLORS.map((c) => [c.key, c.bg]))

/** 校验/清洗：只保留调色板内的颜色 key 与已知的布尔开关 */
export function normalizeAnnotationStyle(raw: unknown): AnnotationStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: AnnotationStyle = {}
  const fg = typeof r.fg === 'string' && ANNO_COLOR_KEYS.has(r.fg) ? r.fg : undefined
  const bg = typeof r.bg === 'string' && ANNO_COLOR_KEYS.has(r.bg) ? r.bg : undefined
  if (fg) out.fg = fg
  if (bg) out.bg = bg
  if (r.underline === true) out.underline = true
  if (r.strike === true) out.strike = true
  if (r.bold === true) out.bold = true
  if (r.italic === true) out.italic = true
  return Object.keys(out).length ? out : undefined
}

/** 样式对象 → CSS 属性表；同时用于渲染期（DOM）与编辑窗口的实时预览（React） */
export function annotationCss(style?: AnnotationStyle): Record<string, string> {
  const out: Record<string, string> = {}
  if (!style) return out
  const fg = style.fg ? FG.get(style.fg) : undefined
  if (fg) out.color = fg
  const bg = style.bg ? BG.get(style.bg) : undefined
  if (bg) out.backgroundColor = bg
  const deco: string[] = []
  if (style.underline) deco.push('underline')
  if (style.strike) deco.push('line-through')
  if (deco.length) out.textDecorationLine = deco.join(' ')
  if (style.bold) out.fontWeight = '700'
  if (style.italic) out.fontStyle = 'italic'
  return out
}

/** 把样式直接写到元素上（渲染期在已生成的 DOM 上套用） */
export function applyAnnotationStyle(el: HTMLElement, style?: AnnotationStyle): void {
  const css = annotationCss(style)
  for (const [k, v] of Object.entries(css)) el.style.setProperty(kebab(k), v)
}

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/**
 * 稳定序列化，供渲染层做「内容是否变化」的比较与跨 effect 传递。
 * 字段顺序固定、布尔用 0/1，避免同一个样式因对象键序不同被误判为变化。
 */
export function serializeStyle(style?: AnnotationStyle): string {
  if (!style) return ''
  const bit = (v?: boolean) => (v ? '1' : '0')
  return [
    style.fg ?? '',
    style.bg ?? '',
    bit(style.underline),
    bit(style.strike),
    bit(style.bold),
    bit(style.italic),
  ].join('|')
}

/** serializeStyle 的逆操作 */
export function parseStyle(s: string): AnnotationStyle | undefined {
  if (!s) return undefined
  const [fg, bg, underline, strike, bold, italic] = s.split('|')
  const out: AnnotationStyle = {}
  if (fg) out.fg = fg
  if (bg) out.bg = bg
  if (underline === '1') out.underline = true
  if (strike === '1') out.strike = true
  if (bold === '1') out.bold = true
  if (italic === '1') out.italic = true
  return Object.keys(out).length ? out : undefined
}

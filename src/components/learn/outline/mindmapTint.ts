/**
 * 本文件负责：思维导图节点的**自定义颜色**——调色板本身，以及「这个色名认不认」。
 *
 * 抽成单独一个文件（而不是写在 MindmapView 里）有两个原因：
 * 1. 深色模式要读盘（见 learn/store/normalize/node），那里不该 import 一个 .tsx；
 * 2. 认识的色名是**数据合法性**的一部分——磁盘上手改出来的 `tint: "蓝色"` 要能丢掉，
 *    而不是渲染时才发现取不到值、画成一块透明。
 *
 * 色名对应 6 个矿物色（与 BRANCH_PALETTES 同一套语汇），另加「默认」表示不自定义。
 * 每个色名给两档（浅色纸面 / 深色纸面），因为同一个色号在两种底上要的不是同一个值：
 * 浅色底上要压得住纸色，深色底上要提得起来、别糊成一片黑。
 */

export interface TintSwatch {
  /** 存到节点上的值（也是菜单里点的那一格） */
  name: string
  /** 中文名，菜单上给 tooltip 用 */
  label: string
  /** 浅色主题下的颜色 */
  light: string
  /** 深色主题下的颜色 */
  dark: string
}

/**
 * 可选的颜色。第一项 `default` 是**取消自定义**——菜单里它就是最左边那格
 * （画成一圈斜线），点了之后节点回到「跟着分支走」。
 */
export const TINT_PALETTE: TintSwatch[] = [
  { name: 'default', label: '默认（随分支）', light: '#a8432f', dark: '#d4745c' },
  { name: '竹青', label: '竹青', light: '#059669', dark: '#34d399' },
  { name: '黛蓝', label: '黛蓝', light: '#2563eb', dark: '#60a5fa' },
  { name: '琥珀', label: '琥珀', light: '#d97706', dark: '#fbbf24' },
  { name: '紫棠', label: '紫棠', light: '#9333ea', dark: '#c084fc' },
  { name: '丹砂', label: '丹砂', light: '#e11d48', dark: '#fb7185' },
  { name: '松石', label: '松石', light: '#0d9488', dark: '#2dd4bf' },
  { name: '墨灰', label: '墨灰', light: '#6e665b', dark: '#a8a29e' },
]

const TINT_NAMES = new Set(TINT_PALETTE.map((t) => t.name))

/**
 * 这个值算不算一个认识的颜色。读盘与右键菜单提交都过它一道：
 * 不认的一律当「没有自定义颜色」处理，绝不把画不出来的值带进渲染。
 */
export function normalizeTint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  // 'default' 与空串在数据里都等于「没有这一项」：前者是菜单里那一格的名字，
  // 后者是「清除自定义色」写下的占位。存着它们等于多存一个「我没改过」，
  // 不如当场归一掉，让「有没有 tint」这一件事只有一种表示。
  if (!name || name === 'default' || !TINT_NAMES.has(name)) return null
  return name
}

/** 色名 → 这一档主题下的色值；不认识（含 default）时给 null，调用方自己兜底 */
export function tintColor(name: string | undefined, dark: boolean): string | null {
  if (!name) return null
  const found = TINT_PALETTE.find((t) => t.name === name)
  if (!found || found.name === 'default') return null
  return dark ? found.dark : found.light
}

/**
 * 取色名对应的调色板项；`default` 也返回它自己（菜单要高亮「当前是哪一格」）。
 * 认不出来时返回 null。
 */
export function tintSwatch(name: string | undefined): TintSwatch | null {
  if (!name) return null
  return TINT_PALETTE.find((t) => t.name === name) ?? null
}

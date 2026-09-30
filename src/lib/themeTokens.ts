/**
 * 超级文档能用的**主题变量名单**，以及「当前主题下这些变量的值」。
 *
 * 为什么名单是静态的：iframe（srcdoc）是一份独立文档，不继承父页面的自定义属性，
 * 而且沙箱（不给 allow-same-origin）让宿主也读不进它的 DOM——所以主题要在合成
 * srcDoc 时以 `:root{…}` 的形式**注入**，切主题时经 postMessage 推一份新的进去。
 * 注入总得列一份变量名；从 CSSOM 现数（document.styleSheets 里的 --* 属性）在
 * 打包版（file://）里会撞上跨源限制，靠不住。名单于是钉在这里，scripts 探针
 * 逐条比对 index.css（见 scripts/agent-ops.test.ts 的 themeTokensTests），
 * 主题里加减变量而忘了这里，探针当场变红。
 *
 * **值永远是活的**：themeCss() 每次调用都从 documentElement 现读——
 * getComputedStyle 按 :root[data-theme] 的层叠胜负给出当前主题的值，
 * 所以「生成时是浅色、现在切到深色」的超级文档会跟着变，而不是停在生成那一刻。
 */

/** 名单必须与 index.css 的 @theme（外加 :root 上的 --scrim）保持一致 */
export const THEME_VAR_NAMES: readonly string[] = [
  // 纸与墨
  '--color-paper',
  '--color-paper-deep',
  '--color-card',
  '--color-ink',
  '--color-ink-strong',
  '--color-ink-soft',
  '--color-ink-faint',
  '--color-line',
  '--color-line-strong',
  '--color-mask',
  // 印章红与语义色
  '--color-seal',
  '--color-seal-deep',
  '--color-ok',
  '--color-ok-deep',
  '--color-ok-text',
  '--color-warn',
  '--color-warn-deep',
  // 表面层级
  '--color-sunken',
  '--color-inset',
  '--color-elevated',
  '--color-code',
  '--color-quote-ink',
  '--color-mark',
  '--color-scroll',
  '--color-scroll-strong',
  // 代码块语法高亮（scope → 令牌类型 → 这一组变量，见 src/syntax 与 index.css）
  '--color-code-comment',
  '--color-code-string',
  '--color-code-number',
  '--color-code-keyword',
  '--color-code-function',
  '--color-code-type',
  '--color-code-variable',
  '--color-code-tag',
  '--color-code-builtin',
  '--color-code-meta',
  '--color-code-punct',
  '--color-code-invalid',
  // 注解调色板
  '--color-anno-blue',
  '--color-anno-purple',
  // 遮罩（模态/抽屉的压暗层）
  '--scrim',
  // 字体
  '--font-sans',
  '--font-mono',
]

/**
 * 当前主题下这些变量的一份 `:root{…}` 样式块；一样都读不到时回空串
 * （调用方就不注入——超级文档回落到自己的配色，不会更糟）。
 */
export function themeCssBlock(): string {
  try {
    const style = getComputedStyle(document.documentElement)
    const decls = THEME_VAR_NAMES.map((name) => {
      const value = style.getPropertyValue(name).trim()
      return value ? `${name}:${value};` : ''
    }).join('')
    return decls ? `:root{${decls}}` : ''
  } catch {
    return ''
  }
}

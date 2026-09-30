/**
 * 内置插件：跟着应用一起编译进来的那几个（见 lib/renderPlugins 的注册表）。
 *
 * 目前只有 ```plot 一个——它是这套接口的**第一个真实用例**，也是样板：
 * 解析期只产出一个占位容器（renderNote 是同步的，画不了图），
 * 真正的图像在 DOM 提交后由 lib/plot 挂上去。
 *
 * 新增一个内置插件＝在这里 register 一次；不认识的语法一律退回 marked 的默认渲染
 * （代码块），不会因为没人认领就变成一片空白。
 */
import { t } from '../i18n'
import { hydrateCodeBlocks } from './codeHighlight'
import { hydrateCodeRun } from './codeBlockMenu'
import { hydratePlots } from './plot'
import { registerRenderPlugin, type PluginRenderContext } from './renderPlugins'
import { languageCount } from '../syntax/LanguageAliases'

/** 函数图像围栏的语言标记：```plot + 一段 JSON（见 lib/plot.ts） */
export const PLOT_LANG = 'plot'

/**
 * 绘图表达式最终会被编成 JS 执行（function-plot 底层是 math-codegen 的 new Function），
 * 所以这里拦一道：表达式只需要数学符号，出现浏览器/模块对象一律拒绝、退回源码展示。
 * 属于 best-effort 防护，不追求完备。
 */
const PLOT_FORBIDDEN =
  /\b(?:window|document|globalThis|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|Worker|navigator|cookie|postMessage|require|eval|Function|constructor|prototype|process|import)\b|=>/

function plotFallback(message: string, source: string, ctx: PluginRenderContext): string {
  return (
    `<div class="moji-plot moji-plot-error">` +
    `<div class="moji-plot-msg">${ctx.escape(message)}</div>` +
    `<pre><code>${ctx.escape(source.trim())}</code></pre>` +
    `</div>`
  )
}

/**
 * 占位期就把这张图的高度占住。
 *
 * 为什么必须占住：图是**稍后**才画的（lib/plot 等浏览器空闲了再动态加载绘图库），
 * 而一张图画完会插进一段高约「宽度 × 0.62」的 svg（最宽 720 → 446px）。
 * 不预留的话，正文会在图补上来的那一刻整体长高几百像素——大纲跳转正是这么失灵的：
 * 算目标位置时下面的图还没有高度，人刚跳到地方，图又把它顶了下去，
 * 表现就是「点一次没反应、要点好几次」（点几次之后图都画完了，才对得上）。
 * 预留之后高度从一开始就是最终的：图是「填进一个已经占好的坑」，正文一个字都不动。
 *
 * 两种取值：写死了 height 就按它留（画出来就是这么多像素）；否则按绘制的比例留。
 * 画完/画失败时由 lib/plot 把这一行换成真实高度（结果不变，但不再是估算）。
 */
function plotReserve(raw: string): string {
  try {
    const opts = JSON.parse(raw) as { height?: unknown }
    const h = typeof opts.height === 'number' && Number.isFinite(opts.height) && opts.height > 0 ? Math.round(opts.height) : 0
    return h ? `min-height:${h}px` : 'aspect-ratio:1/0.62'
  } catch {
    // JSON 都读不出来（lib/plot 会给出错误卡片）：不留高度，让错误信息自己撑开
    return ''
  }
}

/**
 * plot 围栏 → 占位容器。真正的图像在 DOM 提交后由 hydratePlots 挂载
 * （renderNote 是同步纯函数，产不出图；绘图库按需动态加载）。
 */
function plotBlock(source: string, ctx: PluginRenderContext): string {
  const raw = source.trim()
  if (!raw) return plotFallback(t('函数图像内容为空'), source, ctx)
  if (PLOT_FORBIDDEN.test(raw)) return plotFallback(t('函数图像表达式含有不被允许的内容'), source, ctx)
  // 用 encodeURIComponent 编码后放进属性，避免 JSON 里的引号/换行与 HTML 转义互相干扰
  return (
    `<div class="moji-plot" data-plot="${ctx.attr(raw)}">` +
    `<div class="moji-plot-stage" style="${plotReserve(raw)}"></div>` +
    `<div class="moji-plot-hint">${t('正在绘制函数图像…')}</div>` +
    `</div>`
  )
}

registerRenderPlugin({
  id: 'plot',
  name: '函数图像',
  builtin: true,
  fences: [PLOT_LANG],
  render: (source: string, ctx: PluginRenderContext) => plotBlock(source, ctx),
  hydrate: (root: HTMLElement) => hydratePlots(root),
})

/**
 * 代码块高亮：所有 ```语言 的围栏（没人认领的那些）。
 *
 * 它不认领任何语言——marked 默认渲染出来的 `<pre><code class="language-x">` 就是
 * 它的入口（见 lib/codeHighlight）。真正的 tokenization 在 src/syntax 里，
 * 语法按需下载、结果缓存；这里只负责「DOM 提交之后把颜色补上」。
 */
registerRenderPlugin({
  id: 'code-highlight',
  name: '代码块高亮',
  builtin: true,
  summary: [`${languageCount()} 种语言按需加载`],
  hydrate: (root: HTMLElement) => hydrateCodeBlocks(root),
})

/**
 * 代码块伪编译与运行：给每块代码挂一个右侧悬浮菜单（复制 / 编译 / 运行）。
 *
 * 它是**文档能力**的一部分（和 plot 一样默认开着），但它会花模型请求、还会
 * 执行模型写出来的代码，所以设置页里必须能关——关掉之后代码块就只剩高亮。
 *
 * 编译产物落在数据目录里（见 lib/codeArtifacts 与 electron/runner.ts），
 * 运行在一次性 Worker 沙箱里（见 lib/codeRun），联网每次运行都要用户点头。
 */
registerRenderPlugin({
  id: 'code-run',
  name: '代码块编译运行',
  builtin: true,
  summary: ['鼠标经过代码块才出现的右侧菜单', '经 AI 转译成 JS 后在沙箱里跑', '联网要每次运行确认'],
  hydrate: (root: HTMLElement) => hydrateCodeRun(root),
})

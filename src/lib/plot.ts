import type { FunctionPlotOptions } from 'function-plot'
import { t } from '../i18n'
import { renderInline } from './markdown'
import { normalizePlotData } from './plotExpr'

/**
 * 函数图像渲染。
 *
 * marked 把 ```plot 围栏渲染成占位容器（见 lib/markdown.ts），
 * 这里在 DOM 提交后把容器变成真正的图像。分两步的原因：
 * - renderNote 是同步纯函数，只产出 HTML 字符串，产不出图；
 * - 绘图库（function-plot 解包 ~800KB）按需动态加载，
 *   文档里没有图像时完全不会加载它。
 */

type PlotFn = (options: FunctionPlotOptions) => unknown

/** 成功加载的函数（只缓存成功结果） */
let cached: PlotFn | null = null
/** 在途加载，避免同一时刻重复 import */
let pending: Promise<PlotFn | null> | null = null
/** 最近一次加载失败的原因，用于把真实错误显示给用户 */
let lastError = ''

/**
 * function-plot 只有 CJS 产物，不同打包路径下默认导出的层级不一致：
 * dev 预打包会把 module.exports 整个挂到 default（真正函数在 default.default），
 * 生产构建通常直接就是函数。逐个候选探测，避免绑死某一层形态。
 */
function resolvePlotFn(m: unknown): PlotFn | null {
  const candidates = [
    (m as { default?: { default?: unknown } })?.default?.default,
    (m as { default?: unknown })?.default,
    m,
  ]
  for (const c of candidates) if (typeof c === 'function') return c as PlotFn
  return null
}

/**
 * 按需加载绘图库。
 *
 * 只把**成功**结果缓存下来；失败不缓存，下次调用会重新尝试。
 * 这一点很关键：开发时 Vite 重新预打包依赖（例如新增依赖后）会让旧页面
 * 里已使用的模块地址失效，动态 import 会短暂报错；若把这次失败缓存成
 * null，页面就会一直卡在「加载失败」直到手动刷新。不缓存失败即可自愈。
 */
function loadPlot(): Promise<PlotFn | null> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = import('function-plot')
      .then((m) => {
        const fn = resolvePlotFn(m)
        if (fn) cached = fn
        else lastError = t('函数图像组件的导出形态异常')
        return fn
      })
      .catch((err) => {
        lastError = err instanceof Error ? err.message : String(err)
        return null
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

/** 图像宽度上限，避免在宽屏上拉得过大；下限保证窄栏里仍可读 */
const MIN_WIDTH = 220
const MAX_WIDTH = 720
/** 宽度变化超过这个阈值才重绘，防止拖拽侧栏时疯狂重排 */
const RESIZE_STEP = 16
/** 绘图库加载失败后的退避重试间隔（毫秒）；用尽仍失败才提示错误 */
const RETRY_DELAYS = [300, 800, 1500]
/**
 * 首次绘制让给浏览器的空闲时间。
 *
 * 画一张图是同步的 d3 布局（实测每张 9~15ms），一份文档挂五张图就是 70ms 上下。
 * 这些工作若紧跟正文挂载执行，就会和「切换节点」挤在同一帧里，正文白白晚半拍才上屏。
 * 推迟到空闲时段后，正文先出现，图像紧随其后补上——占位文案「正在绘制函数图像…」
 * 本来就在，补上的过程看着是连贯的。timeout 是兜底：主线程一直忙时也要画出来。
 */
const IDLE_TIMEOUT = 120

/** 空闲时执行 fn；返回取消函数（浏览器没有 requestIdleCallback 时退回 setTimeout） */
function whenIdle(fn: () => void): () => void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number })
    .requestIdleCallback
  if (!ric) {
    const timer = window.setTimeout(fn, 0)
    return () => window.clearTimeout(timer)
  }
  const cancel = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
  const id = ric(fn, { timeout: IDLE_TIMEOUT })
  return () => cancel?.(id)
}

/**
 * 挂载 root 内所有 plot 占位容器；返回清理函数（取消观察、丢弃在途渲染）。
 * 可重复调用：React 每次因内容变化重渲染后都会重新挂载。
 */
export function hydratePlots(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = []
  for (const el of root.querySelectorAll<HTMLElement>('.moji-plot[data-plot]')) {
    const cleanup = hydrateOne(el)
    if (cleanup) cleanups.push(cleanup)
  }
  return () => {
    for (const fn of cleanups) fn()
  }
}

function hydrateOne(el: HTMLElement): (() => void) | null {
  const stage = el.querySelector<HTMLElement>('.moji-plot-stage')
  if (!stage) return null

  const raw = el.dataset.plot ? decodeURIComponent(el.dataset.plot) : ''
  let options: FunctionPlotOptions | null = null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') options = parsed as FunctionPlotOptions
  } catch {
    options = null
  }
  if (!options || !Array.isArray(options.data) || options.data.length === 0) {
    fail(el, stage, t('函数图像格式不正确（需要一段含 data 的 JSON）'), raw)
    return null
  }
  const opts = options
  /*
   * 表达式在这里就归一化：函数库的区间采样器算不了分数次幂（x^(1/3) 会返回空集，
   * 既刷屏 warning 又让整条曲线消失），改写理由与边界见 lib/plotExpr.ts。
   */
  const data = normalizePlotData(opts.data)

  let disposed = false
  let timer = 0
  let retry = 0
  let lastWidth = 0
  const detach: Array<() => void> = []

  // 用舞台元素的宽度而不是外层容器：外层还有内边距，
  // 按外层宽度画会让 svg 比舞台宽、再被 CSS 缩回，坐标与视觉就不一致了
  const currentWidth = () =>
    Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(stage.clientWidth)))

  const render = async () => {
    if (disposed) return
    const width = currentWidth()
    if (width <= 0) return
    const plot = await loadPlot()
    // 组件可能在等待期间已被卸载/换内容，此时再画会画进废弃节点
    if (disposed) return
    if (!plot) {
      // 加载失败多为开发期依赖重新预打包导致的短暂失效：不写死错误，退避重试几次，
      // 期间保留「正在绘制」状态，避免用户看到一个其实会自愈的失败。
      if (retry < RETRY_DELAYS.length) {
        const wait = RETRY_DELAYS[retry++]
        window.clearTimeout(timer)
        timer = window.setTimeout(() => void render(), wait)
        return
      }
      fail(el, stage, lastError ? t('函数图像组件加载失败：{0}', lastError) : t('函数图像组件加载失败'), raw)
      return
    }
    const height =
      typeof opts.height === 'number' && opts.height > 0 ? opts.height : Math.round(width * 0.62)
    try {
      // function-plot 是追加式渲染，重绘前先清空，避免叠出多张图
      stage.replaceChildren()
      plot({ ...opts, data, target: stage, width, height, disableZoom: opts.disableZoom ?? true })
      // 占位期那一行是**估算**（见 lib/markdown 的 plotReserve）：画完就换成真实高度。
      // 换的是一个 0.x 像素级的修正，肉眼看不见，但从此这个坑的深度就是确定的
      stage.style.aspectRatio = 'auto'
      stage.style.minHeight = height + 'px'
      el.querySelector('.moji-plot-hint')?.remove()
      // 之前若失败过（例如依赖重打包），成功后要把错误态清掉
      el.classList.remove('moji-plot-error')
      applyPlotLabels(el, stage)
      // 默认禁用交互缩放：d3-zoom 会劫持滚轮，长文档里会挡住翻页
      if (opts.disableZoom !== false) guardScroll(stage, detach)
      lastWidth = width
    } catch (err) {
      // 给用户看的是「检查表达式与参数」这句，原始异常只进控制台——排查全靠它
      console.warn('函数图像绘制失败', err)
      fail(el, stage, t('函数图像绘制失败，请检查表达式与参数'), raw)
    }
  }

  const schedule = () => {
    if (disposed) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void render(), 120)
  }

  const ro = new ResizeObserver(() => {
    // 容器没有宽度时不重画：隐藏的页签（见 learn/resident）与还没排版的阶段都会量到 0，
    // 那时画出来只会是 MIN_WIDTH 缩着的那一版，白费一次 function-plot 的采样。
    // 等它重新有宽度时 RO 会再来一次，画面自然补上。
    if (stage.clientWidth <= 0) return
    if (Math.abs(currentWidth() - lastWidth) >= RESIZE_STEP) schedule()
  })
  ro.observe(el)
  // 首帧不抢：等正文挂载完、浏览器空下来再画（见 whenIdle 的说明）
  const cancelIdle = whenIdle(() => void render())

  return () => {
    disposed = true
    cancelIdle()
    window.clearTimeout(timer)
    ro.disconnect()
    for (const off of detach) off()
  }
}

/**
 * function-plot 的标题与轴标签是 SVG <text>，没法直接排 LaTeX。
 * 这里只对**含公式标记**的标签做处理：用 HTML 覆盖层（走 renderInline → KaTeX）
 * 叠在原位，并隐藏原 <text>；纯文本标签保持 SVG 原样，避免无谓重排。
 * 位置从渲染后的 getBoundingClientRect 取，因此能跟随自适应缩放。
 */
function applyPlotLabels(el: HTMLElement, stage: HTMLElement): void {
  for (const n of Array.from(el.querySelectorAll('.moji-plot-label'))) n.remove()
  const svg = stage.querySelector('svg')
  if (!svg) return
  // 只有出现公式标记才走覆盖层：$...$ 是 KaTeX 语法，反斜杠说明是 LaTeX 命令
  const markups = ['$', '\\']
  const els = Array.from(svg.querySelectorAll<SVGTextElement>('text.title, text.x.axis-label, text.y.axis-label'))
  // 用 client 坐标换算：容器有边框与 padding，取 offset 会让覆盖层偏离原文字
  const base = el.getBoundingClientRect()
  for (const t of els) {
    const text = t.textContent ?? ''
    const r = t.getBoundingClientRect()
    if (!r.width && !r.height) continue
    const isTitle = t.classList.contains('title')
    /*
     * 两种标签要走 HTML 覆盖层：
     * 1. 含公式标记的（SVG <text> 排不了 LaTeX）；
     * 2. **本身就是标题、而且已经宽过容器**的——SVG 文本不换行，长标题会被
     *    .moji-plot 的 overflow:hidden 从右边切掉（用户截过图：标题最后几个字没了）。
     *    交给覆盖层，那边会换行并收边。
     */
    const tooWide = isTitle && r.width > el.clientWidth - 24
    if (!markups.some((m) => text.includes(m)) && !tooWide) continue
    const overlay = document.createElement('div')
    overlay.className = `moji-plot-label${isTitle ? ' moji-plot-label-title' : ''}`
    overlay.innerHTML = renderInline(text)
    overlay.style.left = `${r.left + r.width / 2 - base.left}px`
    overlay.style.top = `${r.top + r.height / 2 - base.top}px`
    el.appendChild(overlay)
    t.style.display = 'none'
    /*
     * 覆盖层的收边（标题最容易出这个问题）。
     *
     * 覆盖层是 absolute + translate(-50%,-50%)，宽度由内容决定：一句长标题在
     * .moji-plot 的 overflow:hidden 里会被**右边裁掉**（用户截过图：标题最后几个字没了）。
     * 所以量一次，做两件事：
     * 1. 宽了就换行（CSS 那边给 title 放开 white-space 与 max-width），并把锚点从
     *    「垂直居中」改成「从原标题顶部往下排」——不然两行标题会往上顶进图里；
     * 2. 万一锚点本身靠边（宽度不够两行也放不下），把 left 夹回容器内，别指望父级不裁。
     */
    const box = overlay.getBoundingClientRect()
    const pad = 8
    const avail = base.width - pad * 2
    /*
     * 判据要**同时看原文本**：覆盖层是 absolute（右边界 auto），它自己一开始就被
     * 左偏移挤成窄窄一条（实测 620 的容器里只有 298），拿它自己量根本量不出「宽了」。
     * r.width 是 SVG 里那段文字的真实宽度，那才是该比的数。
     */
    if (r.width > avail || box.width > avail) {
      /*
       * 标题宽过容器：**铺满可用宽度来换行**，并改掉锚点。
       *
       * 两处都必须显式写死，不能只给 max-width：
       * 1. 覆盖层是 absolute、右边界 auto，可用宽度会被 left 吃掉一半（实测 620 的容器
       *    只换来 298 宽、四行）；
       * 2. 默认 transform 是 translate(-50%,-50%)（以原标题中心为准），两行标题
       *    按中心排会往上顶出容器。标题改成「占满一行宽度、从原标题顶边往下排」。
       */
      if (isTitle) {
        overlay.style.width = `${avail}px`
        overlay.style.transform = 'translateY(0)'
        overlay.style.left = `${pad}px`
        overlay.style.top = `${r.top - base.top}px`
      } else {
        overlay.style.maxWidth = `${avail}px`
        const wrapped = overlay.getBoundingClientRect()
        const center = r.left + r.width / 2 - base.left
        const half = wrapped.width / 2
        overlay.style.left = `${Math.min(Math.max(center, half + pad), base.width - half - pad)}px`
      }
    }
  }
}

/**
 * 在捕获阶段截住滚轮/触摸：阻止其到达 d3-zoom（否则滚动会变成缩放），
 * 但不 preventDefault，浏览器该滚的页照常滚。
 */
function guardScroll(stage: HTMLElement, detach: Array<() => void>): void {
  const stop = (e: Event) => e.stopPropagation()
  for (const type of ['wheel', 'touchstart', 'touchmove']) {
    stage.addEventListener(type, stop, { capture: true })
    detach.push(() => stage.removeEventListener(type, stop, { capture: true }))
  }
}

function fail(el: HTMLElement, stage: HTMLElement, message: string, source: string): void {
  el.classList.add('moji-plot-error')
  el.querySelector('.moji-plot-hint')?.remove()
  // 图画不出来就别再占着那块地方：错误信息自己有多高就多高（见 lib/markdown 的 plotReserve）
  stage.style.aspectRatio = 'auto'
  stage.style.minHeight = '0px'
  const box = document.createElement('div')
  box.className = 'moji-plot-msg'
  box.textContent = message
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = source
  pre.appendChild(code)
  stage.replaceChildren(box, pre)
}

/**
 * 交给教学 Agent 的语法说明（写进系统提示词，与上面的实现保持同步）。
 *
 * 关于 graphType：function-plot 的采样器由 graphType 决定，默认 graphType 是
 * interval，只支持 linear / implicit。points、parametric、polar 必须显式换成
 * polyline / scatter 才会切到 builtIn 采样器，否则运行时会抛错。
 * 变量名由采样器固定传参决定：参数曲线用 t，极坐标用 theta。
 */
export const PLOT_SYNTAX_GUIDE = `函数图像：用三个反引号 + plot 包一段 JSON，即可在笔记里插入可交互的函数图像。

基本结构（除 data 外都可省略）：
- title：图标题；需要公式时用行内 LaTeX（$...$），会被正确排版
- xAxis / yAxis：{ "domain": [min, max], "label": "x", "grid": true }；type 可选 "log"；
  label 同样支持 $...$ 公式
- data：图形数组，每项取下列形态之一
- annotations：[{ "x": 1, "y": 1, "label": "切点" }]

data 各形态（points / parametric / polar 必须写 graphType，否则会当成区间采样而报错）：
1) 显式函数：{ "fn": "x^2" }
   可加切线：{ "fn": "x^2", "derivative": { "fn": "2*x", "x0": 1 } }
   可加割线：{ "fn": "x^2", "secants": [{ "x0": 0, "x1": 1 }] }
   可指定颜色：{ "fn": "sin(x)", "color": "#a8432f" }
2) 参数曲线（变量用 t）：{ "graphType": "polyline", "fnType": "parametric", "x": "cos(t)", "y": "sin(t)" }
3) 极坐标（变量用 theta）：{ "graphType": "polyline", "fnType": "polar", "r": "1 + cos(theta)" }
4) 散点：{ "graphType": "scatter", "fnType": "points", "points": [[1, 1], [2, 4]] }
5) 向量：{ "graphType": "polyline", "fnType": "vector", "vector": [2, 1], "offset": [0, 0] }
6) 隐函数（用 interval 采样，需同时给 graphType 与 fnType）：
   { "graphType": "interval", "fnType": "implicit", "fn": "x^2 + y^2 - 1" }

写法要求：
- 乘号必须写出来（2*x 而不是 2x），乘方用 ^；支持 sin cos tan exp log sqrt nthRoot abs 等。
- **开方只能写 sqrt(x)（平方根）或 nthRoot(x,3)（三次方根），不要写 x^(1/3) 这类分数次幂**：
  区间采样器只认整数指数，碰到分数会当成空集，那条曲线一个点都画不出来。
  （真写了也不会错：渲染时 x^(1/3) 会被自动改写成 nthRoot(x,3)，但自己写清楚更稳，
  而且 nthRoot 在自变量为负时也画得出来——奇数次方根对负数是有定义的。）
- 表达式里只能用数学函数与四则运算，不要出现浏览器对象或函数定义。
- 图像默认不可缩放（避免在文档里滚动时误触），需要交互缩放时加 "disableZoom": false。
- 只在图像确实有助于理解时使用，一张图配一两句文字说明。`

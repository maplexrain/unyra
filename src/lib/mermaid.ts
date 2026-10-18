/**
 * Mermaid 图表渲染。
 *
 * marked 把 ```mermaid 围栏渲染成占位容器（见 lib/builtinPlugins.ts），
 * 这里在 DOM 提交后把容器变成真正的 SVG 图表。分两步的原因：
 * - renderNote 是同步纯函数，只产出 HTML 字符串，产不出图；
 * - 绘图库（mermaid 解包 ~2MB）按需动态加载，
 *   文档里没有图表时完全不会加载它。
 */
import { t } from '../i18n'
import type { PluginRenderContext } from './renderPlugins'

export const MERMAID_LANG = 'mermaid'

type MermaidApi = typeof import('mermaid').default

let cached: MermaidApi | null = null
let pending: Promise<MermaidApi | null> | null = null
let lastError = ''

function resolveMermaid(m: unknown): MermaidApi | null {
  const candidate = (m as { default?: unknown })?.default ?? m
  if (candidate && typeof (candidate as { render?: unknown }).render === 'function') {
    return candidate as MermaidApi
  }
  return null
}

export function loadMermaid(): Promise<MermaidApi | null> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = import('mermaid')
      .then((m) => {
        const api = resolveMermaid(m)
        if (api) {
          cached = api
        } else {
          lastError = t('Mermaid 绘图库导出异常')
        }
        return api
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

export function mermaidFallback(message: string, source: string, ctx: PluginRenderContext): string {
  return (
    `<div class="moji-mermaid moji-mermaid-error">` +
    `<div class="moji-mermaid-msg">${ctx.escape(message)}</div>` +
    `<pre><code>${ctx.escape(source.trim())}</code></pre>` +
    `</div>`
  )
}

export function mermaidBlock(source: string, ctx: PluginRenderContext): string {
  const raw = source.trim()
  if (!raw) return mermaidFallback(t('图表内容为空'), source, ctx)
  return (
    `<div class="moji-mermaid" data-mermaid="${ctx.attr(raw)}">` +
    `<div class="moji-mermaid-stage"></div>` +
    `<div class="moji-mermaid-hint">${t('正在绘制图表…')}</div>` +
    `</div>`
  )
}

let mermaidIdSeed = 0

function fail(el: HTMLElement, stage: HTMLElement, message: string, source: string): void {
  el.classList.add('moji-mermaid-error')
  el.querySelector('.moji-mermaid-hint')?.remove()
  const box = document.createElement('div')
  box.className = 'moji-mermaid-msg'
  box.textContent = message
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = source
  pre.appendChild(code)
  stage.replaceChildren(box, pre)
}

function isDarkModeActive(): boolean {
  if (typeof document === 'undefined') return false
  const root = document.documentElement
  const dataTheme = root.getAttribute('data-theme')
  if (dataTheme === 'dark' || dataTheme === 'graphite' || dataTheme === 'navy' || dataTheme === 'contrast' || dataTheme === 'black') {
    return true
  }
  if (root.classList.contains('dark')) return true
  if (dataTheme === 'system' || !dataTheme) {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
}

/**
 * 计算并保留 Mermaid 图表的自然固有尺寸，防止小尺寸图表被强制撑大至 100% 容器宽度导致巨大拉伸
 */
export function computeMermaidSvgMaxWidth(
  styleMaxWidth?: string | null,
  viewBox?: string | null,
  widthAttr?: string | null,
): string {
  let naturalWidth = 0
  if (styleMaxWidth && styleMaxWidth.endsWith('px')) {
    naturalWidth = parseFloat(styleMaxWidth)
  } else {
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/)
      if (parts.length === 4) {
        naturalWidth = parseFloat(parts[2])
      }
    }
    if (!naturalWidth && widthAttr && !widthAttr.includes('%')) {
      naturalWidth = parseFloat(widthAttr)
    }
  }

  if (naturalWidth > 0 && Number.isFinite(naturalWidth)) {
    return `min(100%, ${Math.round(naturalWidth)}px)`
  }
  return '100%'
}

/* ---------- 超高图表先折起 ---------- */

/**
 * 一张图最多先露这么高：超了就折起，给一颗「展开图表」。
 *
 * 为什么要有这一条：竖链图的高度随节点数线性长——十来节就是**一屏多**。正文被它整段
 * 顶走，想读下一节得先滚过一整张图；而它横向只占半边，空出来的地方全是留白。
 * 折起之后一屏里还看得见上下文，想细看再展开。
 *
 * 阈值是「窗口的六成，且不超过 460px」：窗口高就多看一点，窗口矮也不会把正文挤没。
 * CSS 里的 max-height 必须与这里同值（见 styles/code.css 的 .moji-mermaid-tall）。
 */
export const MERMAID_FOLD_MAX_PX = 460
export const MERMAID_FOLD_VIEWPORT_RATIO = 0.58

/** 这一刻允许露出的高度（px）：纯函数，窗口高度由调用方给，便于钉住 */
export function mermaidFoldLimit(viewportHeight: number): number {
  return Math.min(MERMAID_FOLD_MAX_PX, Math.round(viewportHeight * MERMAID_FOLD_VIEWPORT_RATIO))
}

/** 这张图要不要折起 */
export function shouldFoldMermaid(contentHeight: number, viewportHeight: number): boolean {
  return contentHeight > mermaidFoldLimit(viewportHeight)
}

/**
 * 量一次高度，超高就折起。返回 false 表示**还没排版、量不出来**（常驻但隐藏的那一片
 * 是 display:none，scrollHeight 是 0）——调用方据此等它真的显示出来再量。
 */
function foldIfTall(el: HTMLElement, stage: HTMLElement): boolean {
  const height = stage.scrollHeight
  if (height <= 0) return false
  if (!shouldFoldMermaid(height, window.innerHeight)) return true

  el.classList.add('moji-mermaid-tall')
  // 同一张图被重复挂载时不留第二颗按钮（幂等）
  el.querySelector('.moji-mermaid-fold')?.remove()
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'moji-mermaid-fold'
  const sync = () => {
    const open = el.classList.contains('moji-mermaid-open')
    btn.textContent = open ? t('收起图表') : t('展开图表')
    btn.setAttribute('aria-expanded', open ? 'true' : 'false')
  }
  btn.addEventListener('click', () => {
    el.classList.toggle('moji-mermaid-open')
    sync()
  })
  sync()
  el.appendChild(btn)
  return true
}

/* ---------- 标签折行宽度 ---------- */

/**
 * 标签折行宽度（px）：**图表高矮真正的旋钮**（见 initialize 里 flowchart 那段说明）。
 *
 * 默认 120 会把一行字从中间掰成两行，节点跟着长高一行；放宽到「容器宽度减去内边距」，
 * 一行放得下的就不折，节点从三行回到两行。上限 320——再宽只是留白（最长的一行本来也
 * 没那么长）；下限 200 兜住很窄的分栏。量不到容器宽度（隐藏着的常驻页）时退回 240。
 */
export const MERMAID_WRAP_MIN = 200
export const MERMAID_WRAP_MAX = 320
export const MERMAID_WRAP_FALLBACK = 240

export function mermaidWrapWidth(containerWidth: number): number {
  if (!(containerWidth > 0)) return MERMAID_WRAP_FALLBACK
  // 56 = 图表块左右内边距（12×2）+ 箭头与框线要的那点余量
  return Math.round(Math.min(MERMAID_WRAP_MAX, Math.max(MERMAID_WRAP_MIN, containerWidth - 56)))
}

function hydrateOne(el: HTMLElement): (() => void) | null {
  const stage = el.querySelector<HTMLElement>('.moji-mermaid-stage')
  if (!stage) return null

  const raw = el.dataset.mermaid ? decodeURIComponent(el.dataset.mermaid) : ''
  if (!raw.trim()) {
    fail(el, stage, t('图表内容为空'), raw)
    return null
  }

  let disposed = false
  /** 「等它显示出来再量高度」那只观察者（见 foldIfTall）：卸载时要一起断开 */
  let foldCleanup: (() => void) | null = null

  const render = async () => {
    if (disposed) return
    const mermaid = await loadMermaid()
    if (disposed) return
    if (!mermaid) {
      fail(el, stage, lastError || t('无法载入 Mermaid 绘图库'), raw)
      return
    }

    const id = `moji-mermaid-${Date.now().toString(36)}-${(++mermaidIdSeed).toString(36)}`
    const isDark = isDarkModeActive()

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: 'inherit',
        fontSize: 13,
        /**
         * 流程图排版：**把每一行字放得下**，是让图变矮最有效的一招。
         *
         * 教学文档里的流程图多半是一条竖链——十个节点、每个两三行字。默认
         * `wrappingWidth: 120` 会把「水、糖、脂、蛋白质、核酸」从中间掰成两行
         * （「水、糖、脂、蛋」/「白质、核酸」），每个节点凭空多一行；十来个节点摞起来
         * 就是一屏多。放宽到「容器宽度减去内边距」之后，一行放得下的不再折，
         * 节点从三行回到两行——实测那条 10 节点的竖链从 1201px 降到 1006px，
         * 而且不再断在词中间（见 mermaidWrapWidth）。
         *
         * `nodeSpacing` / `rankSpacing` / `padding` **不在这里调**：mermaid 12.x 的
         * dagre 布局用 `data4Layout` 上那份带 `|| 50` 兜底的默认值把 flowchart 的这几个
         * 键整个遮蔽了（见源码 prepareLayoutForDagre 的取值顺序与 #7932），设了也不生效
         * ——试过 0 到 160，节点间距一动不动，全是 40px。
         */
        flowchart: {
          useMaxWidth: true,
          htmlLabels: true,
          curve: 'basis',
          // 按这一格此刻的宽度算：宽栏里一行放得下就不折，窄栏里也不至于折得过碎
          wrappingWidth: mermaidWrapWidth(el.clientWidth),
        },
        sequence: {
          useMaxWidth: true,
          actorFontSize: 13,
          noteFontSize: 12,
          messageFontSize: 13,
        },
        themeVariables: {
          fontFamily: 'inherit',
          fontSize: '13px',
        },
      })
      const { svg, bindFunctions } = await mermaid.render(id, raw)
      if (disposed) return

      el.querySelector('.moji-mermaid-hint')?.remove()
      el.classList.remove('moji-mermaid-error')
      stage.innerHTML = svg
      const svgEl = stage.querySelector('svg')
      if (svgEl) {
        svgEl.style.maxWidth = computeMermaidSvgMaxWidth(
          svgEl.style.maxWidth,
          svgEl.getAttribute('viewBox'),
          svgEl.getAttribute('width'),
        )
        svgEl.style.height = 'auto'
        svgEl.style.display = 'inline-block'
      }
      bindFunctions?.(stage)
      /*
       * 超高就折起（见 foldIfTall）。量不出高度（这一片此刻是 display:none 的常驻页）
       * 就等它真的显示出来再量——否则后台写好的长图，切过去时照样把正文顶走一屏。
       */
      if (!foldIfTall(el, stage)) {
        const io = new IntersectionObserver((entries) => {
          if (!entries.some((e) => e.isIntersecting)) return
          io.disconnect()
          if (!disposed) foldIfTall(el, stage)
        })
        io.observe(el)
        foldCleanup = () => io.disconnect()
      }
    } catch (err) {
      if (disposed) return
      // 清理 mermaid.render 失败时可能残留在 body 上的临时节点
      const dangling = document.getElementById(id) ?? document.getElementById(`d${id}`)
      dangling?.remove()
      const msg = err instanceof Error ? err.message : String(err)
      fail(el, stage, t('图表语法错误：{0}', msg), raw)
    }
  }

  void render()

  return () => {
    disposed = true
    foldCleanup?.()
  }
}

/**
 * 挂载 root 内所有 mermaid 占位容器；返回清理函数。
 */
export function hydrateMermaid(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = []
  for (const el of root.querySelectorAll<HTMLElement>('.moji-mermaid[data-mermaid]')) {
    const cleanup = hydrateOne(el)
    if (cleanup) cleanups.push(cleanup)
  }
  return () => {
    for (const fn of cleanups) fn()
  }
}

/**
 * 教学 Agent 的 Mermaid 语法指引（用于系统提示词与指引）。
 */
export const MERMAID_SYNTAX_GUIDE = `图表与流程图：用三个反引号 + mermaid 插入图表（如 \`\`\`mermaid\nflowchart TD\n    A[开始] --> B[处理]\n\`\`\`）。
- 支持流程图 (flowchart / graph)、序列图 (sequenceDiagram)、状态图 (stateDiagram-v2)、类图 (classDiagram)、实体关系图 (erDiagram)、甘特图 (gantt)、饼图 (pie) 等标准 Mermaid 语法。
- 适合在讲解概念流转、状态变迁、架构关系、执行时序时使用。
- **排版纪律**（图太大就会把正文挤走，读者得滚过一整屏才看得见下一段）：
  · 一张图不超过 8 个节点；更多内容拆成两三张（每张一个阶段），或只画主干、细节写正文；
  · 竖排（TD）只适合六节以内的短链；更长的链条改横排（LR）或拆图，**不要**排成一条十几节的竖线；
  · 节点文案一行说清，别用 <br/> 堆三行；确需换行时最多两行；
  · 同一节里不要连排好几张图，图与图之间要有正文解释。`

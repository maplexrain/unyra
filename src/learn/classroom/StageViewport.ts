/**
 * 16:9 互动课堂沙箱画布容器 (StageViewport)
 * 严格锁定 1920x1080 逻辑坐标系，通过 CSS transform 等比自适应任何宿主视口
 */
import katex from 'katex'

export class StageViewport {
  private wrapperEl: HTMLElement
  private canvasEl: HTMLElement
  private resizeObserver: ResizeObserver | null = null

  constructor(container: HTMLElement) {
    this.wrapperEl = document.createElement('div')
    this.wrapperEl.className = 'lesson-stage-wrapper'

    this.canvasEl = document.createElement('div')
    this.canvasEl.className = 'lesson-stage-canvas'

    // 锁定 1920x1080 绝对逻辑分辨率与中心缩放原点
    Object.assign(this.canvasEl.style, {
      width: '1920px',
      height: '1080px',
      position: 'relative',
      overflow: 'hidden',
      transformOrigin: 'center center',
      flexShrink: '0',
    })

    this.wrapperEl.appendChild(this.canvasEl)
    container.appendChild(this.wrapperEl)

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.recalculateScale())
      this.resizeObserver.observe(this.wrapperEl)
    }
    this.recalculateScale()
  }

  /** 计算并应用当前最适宜的等比缩放系数 */
  public recalculateScale(): void {
    const { clientWidth, clientHeight } = this.wrapperEl
    if (!clientWidth || !clientHeight) return
    const scale = Math.min(clientWidth / 1920, clientHeight / 1080)
    this.canvasEl.style.transform = `scale(${scale})`
  }

  /** 将 HTML 片段内的 LaTeX 公式 ($...$ 和 $$...$$) 预先编译为 KaTeX 节点 */
  private renderMathFormulas(html: string): string {
    // 块级公式 $$...$$
    let res = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
      try {
        return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false })
      } catch {
        return tex
      }
    })

    // 行内公式 $...$（避免匹配到货币符号，要求前后有定界或字符）
    res = res.replace(/(^|[^\\])\$([^\$\n]+?)\$/g, (_, prefix, tex) => {
      try {
        const rendered = katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false })
        return `${prefix}${rendered}`
      } catch {
        return `${prefix}$${tex}$`
      }
    })

    return res
  }

  /** 挂载新画面初始 DOM，作为本画面的状态基准点 */
  public mountScene(html: string): void {
    const parsedHtml = this.renderMathFormulas(html)
    this.canvasEl.innerHTML = parsedHtml
  }

  /** 获取画布内指定 ID 的受控元素 */
  public getElement(id: string): HTMLElement | null {
    if (!id) return null
    // 去除误带的 #
    const cleanId = id.replace(/^#/, '')
    try {
      return this.canvasEl.querySelector(`#${CSS.escape(cleanId)}`)
    } catch {
      return this.canvasEl.querySelector(`[id="${cleanId}"]`)
    }
  }

  /** 获取外层容器 */
  public getWrapper(): HTMLElement {
    return this.wrapperEl
  }

  /** 获取内层画布容器 */
  public getCanvas(): HTMLElement {
    return this.canvasEl
  }

  public destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.wrapperEl.remove()
  }
}

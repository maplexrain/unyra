/**
 * 互动课堂预置语义组件库 (components.ts)
 * 允许教学生成工作流直接调用高阶语义组件标签 (<ui-card>, <ui-concept>, <ui-code> 等)，
 * 避免让 Agent 手写冗长晦涩的底层 HTML/CSS 结构，并自动挂载动画标识与主题类名。
 */

/** 内置轻量 SVG 图标集（纯内联矢量，无外部运行时依赖） */
const ICONS: Record<string, string> = {
  sparkles:
    '<svg class="comp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>',
  bulb:
    '<svg class="comp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  code:
    '<svg class="comp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  check:
    '<svg class="comp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  star:
    '<svg class="comp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  info:
    '<svg class="comp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  warn:
    '<svg class="comp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  target:
    '<svg class="comp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  chart:
    '<svg class="comp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
  book:
    '<svg class="comp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/></svg>',
}

/** 辅助：将 HTML 字符串转换成实体 DOM 节点 */
function htmlToElement(html: string): Element {
  const container = document.createElement('div')
  container.innerHTML = html.trim()
  return container.firstElementChild || document.createElement('div')
}

/** 提取并透传元素上的基础通用属性 (id, data-hidden, anim, class, style) */
function getCommonAttributes(el: Element, extraClasses: string = ''): string {
  const id = el.getAttribute('id')
  const isHidden = el.hasAttribute('data-hidden')
  const anim = el.getAttribute('anim') || el.getAttribute('data-anim')
  const cls = el.getAttribute('class') || ''
  const style = el.getAttribute('style') || ''

  const parts: string[] = []
  if (id) parts.push(`id="${id}"`)
  if (isHidden) parts.push('data-hidden')
  if (anim) parts.push(`data-anim="${anim}"`)

  const combinedClass = [extraClasses, cls].filter(Boolean).join(' ')
  if (combinedClass) parts.push(`class="${combinedClass}"`)
  if (style) parts.push(`style="${style}"`)

  return parts.join(' ')
}

/** 展开单一自定义组件节点 */
function transformCustomElement(el: Element): Element {
  const tagName = el.tagName.toLowerCase()

  switch (tagName) {
    case 'ui-card': {
      const title = el.getAttribute('title') || ''
      const subtitle = el.getAttribute('subtitle') || ''
      const badge = el.getAttribute('badge') || ''
      const badgeColor = el.getAttribute('badge-color') || 'seal'
      const iconKey = el.getAttribute('icon') || 'bulb'
      const iconSvg = ICONS[iconKey] || ICONS.sparkles
      const innerHtml = el.innerHTML
      const attrs = getCommonAttributes(el, 'card-glass card-ui')

      return htmlToElement(`
        <div ${attrs}>
          ${(title || badge || iconSvg) ? `
            <div class="card-ui-header">
              <div class="card-ui-title-group">
                <span class="card-ui-icon">${iconSvg}</span>
                <div class="card-ui-title-box">
                  <h3 class="card-ui-title">${title}</h3>
                  ${subtitle ? `<span class="card-ui-subtitle">${subtitle}</span>` : ''}
                </div>
              </div>
              ${badge ? `<span class="badge-pill badge-${badgeColor}">${badge}</span>` : ''}
            </div>
          ` : ''}
          <div class="card-ui-body">
            ${innerHtml}
          </div>
        </div>
      `)
    }

    case 'ui-split': {
      const gap = el.getAttribute('gap') || '48'
      const innerHtml = el.innerHTML
      const attrs = getCommonAttributes(el, 'stage-split')
      return htmlToElement(`<div ${attrs} style="gap: ${gap}px">${innerHtml}</div>`)
    }

    case 'ui-split-3': {
      const gap = el.getAttribute('gap') || '36'
      const innerHtml = el.innerHTML
      const attrs = getCommonAttributes(el, 'stage-split-3')
      return htmlToElement(`<div ${attrs} style="gap: ${gap}px">${innerHtml}</div>`)
    }

    case 'ui-grid-2x2': {
      const gap = el.getAttribute('gap') || '36'
      const innerHtml = el.innerHTML
      const attrs = getCommonAttributes(el, 'stage-grid-2x2')
      return htmlToElement(`<div ${attrs} style="gap: ${gap}px">${innerHtml}</div>`)
    }

    case 'ui-concept': {
      const term = el.getAttribute('term') || ''
      const tag = el.getAttribute('tag') || ''
      const definition = el.getAttribute('definition') || el.innerHTML || ''
      const keypoint = el.getAttribute('keypoint') || ''
      const attrs = getCommonAttributes(el, 'card-glass concept-card')

      return htmlToElement(`
        <div ${attrs}>
          <div class="concept-header">
            <span class="concept-term">${term}</span>
            ${tag ? `<span class="badge-pill badge-seal">${tag}</span>` : ''}
          </div>
          <div class="concept-def">${definition}</div>
          ${keypoint ? `
            <div class="concept-keypoint">
              <span class="concept-keypoint-tag">核心要点</span>
              <span class="concept-keypoint-text">${keypoint}</span>
            </div>
          ` : ''}
        </div>
      `)
    }

    case 'ui-formula': {
      const latex = el.getAttribute('latex') || el.textContent || ''
      const title = el.getAttribute('title') || ''
      const desc = el.getAttribute('desc') || ''
      const attrs = getCommonAttributes(el, 'card-glass formula-card')

      return htmlToElement(`
        <div ${attrs}>
          ${title ? `<div class="formula-title">${title}</div>` : ''}
          <div class="formula-box">$$${latex.trim()}$$</div>
          ${desc ? `<div class="formula-desc">${desc}</div>` : ''}
        </div>
      `)
    }

    case 'ui-code': {
      const lang = el.getAttribute('lang') || 'code'
      const title = el.getAttribute('title') || ''
      const rawCode = el.innerHTML
      const attrs = getCommonAttributes(el, 'code-card')

      return htmlToElement(`
        <div ${attrs}>
          <div class="code-header">
            <span class="code-dots"><i class="dot-r"></i><i class="dot-y"></i><i class="dot-g"></i></span>
            <span class="code-title">${title || lang}</span>
            <span class="code-lang">${lang}</span>
          </div>
          <pre class="code-content"><code>${rawCode}</code></pre>
        </div>
      `)
    }

    case 'ui-compare': {
      const leftTitle = el.getAttribute('left-title') || '方案 A'
      const leftBadge = el.getAttribute('left-badge') || ''
      const rightTitle = el.getAttribute('right-title') || '方案 B'
      const rightBadge = el.getAttribute('right-badge') || ''
      const vsText = el.getAttribute('vs') || 'VS'
      const attrs = getCommonAttributes(el, 'card-glass compare-card')

      const leftSlot = el.querySelector('[slot="left"]')?.innerHTML || ''
      const rightSlot = el.querySelector('[slot="right"]')?.innerHTML || ''
      const fallbackChildren = Array.from(el.children).filter((c) => !c.hasAttribute('slot'))
      const leftContent = leftSlot || (fallbackChildren[0] ? fallbackChildren[0].outerHTML : '')
      const rightContent = rightSlot || (fallbackChildren[1] ? fallbackChildren[1].outerHTML : '')

      return htmlToElement(`
        <div ${attrs}>
          <div class="compare-col compare-left">
            <div class="compare-header">
              <span class="compare-title">${leftTitle}</span>
              ${leftBadge ? `<span class="badge-pill badge-sky">${leftBadge}</span>` : ''}
            </div>
            <div class="compare-body">${leftContent}</div>
          </div>
          <div class="compare-divider">
            <span class="compare-badge">${vsText}</span>
          </div>
          <div class="compare-col compare-right">
            <div class="compare-header">
              <span class="compare-title">${rightTitle}</span>
              ${rightBadge ? `<span class="badge-pill badge-seal">${rightBadge}</span>` : ''}
            </div>
            <div class="compare-body">${rightContent}</div>
          </div>
        </div>
      `)
    }

    case 'ui-steps': {
      const title = el.getAttribute('title') || ''
      const innerHtml = el.innerHTML
      const attrs = getCommonAttributes(el, 'steps-flow')

      return htmlToElement(`
        <div ${attrs}>
          ${title ? `<div class="steps-title">${title}</div>` : ''}
          <div class="steps-container">${innerHtml}</div>
        </div>
      `)
    }

    case 'ui-step': {
      const num = el.getAttribute('num') || '1'
      const title = el.getAttribute('title') || ''
      const innerHtml = el.innerHTML
      const attrs = getCommonAttributes(el, 'step-item')

      return htmlToElement(`
        <div ${attrs}>
          <div class="step-num">${num}</div>
          <div class="step-content">
            ${title ? `<div class="step-title">${title}</div>` : ''}
            <div class="step-desc">${innerHtml}</div>
          </div>
        </div>
      `)
    }

    case 'ui-stat': {
      const value = el.getAttribute('value') || '0'
      const label = el.getAttribute('label') || ''
      const subtext = el.getAttribute('subtext') || ''
      const suffix = el.getAttribute('suffix') || ''
      const iconKey = el.getAttribute('icon') || 'chart'
      const iconSvg = ICONS[iconKey] || ICONS.chart
      const attrs = getCommonAttributes(el, 'stat-card')

      return htmlToElement(`
        <div ${attrs}>
          <div class="stat-top">
            <span class="stat-icon">${iconSvg}</span>
            <span class="stat-label">${label}</span>
          </div>
          <div class="stat-value-box">
            <span class="stat-value" data-anim="countUp" data-target="${value.replace(/[^0-9.]/g, '')}" data-suffix="${suffix}">${value}</span>
          </div>
          ${subtext ? `<div class="stat-subtext">${subtext}</div>` : ''}
        </div>
      `)
    }

    case 'ui-callout': {
      const type = el.getAttribute('type') || 'tip'
      const title = el.getAttribute('title') || (type === 'warn' ? '重要提醒' : type === 'danger' ? '警示' : '重点提示')
      const iconKey = type === 'warn' ? 'warn' : type === 'danger' ? 'warn' : 'bulb'
      const iconSvg = ICONS[iconKey]
      const innerHtml = el.innerHTML
      const attrs = getCommonAttributes(el, `callout-card callout-${type}`)

      return htmlToElement(`
        <div ${attrs}>
          <div class="callout-header">
            <span class="callout-icon">${iconSvg}</span>
            <span class="callout-title">${title}</span>
          </div>
          <div class="callout-body">${innerHtml}</div>
        </div>
      `)
    }

    case 'ui-quote': {
      const quote = el.getAttribute('quote') || el.innerHTML || ''
      const author = el.getAttribute('author') || ''
      const source = el.getAttribute('source') || ''
      const attrs = getCommonAttributes(el, 'quote-card')

      return htmlToElement(`
        <div ${attrs}>
          <div class="quote-mark">“</div>
          <blockquote class="quote-text">${quote}</blockquote>
          ${author ? `
            <div class="quote-meta">
              <span class="quote-author">—— ${author}</span>
              ${source ? `<span class="quote-source">《${source}》</span>` : ''}
            </div>
          ` : ''}
        </div>
      `)
    }

    case 'ui-quiz': {
      const question = el.getAttribute('question') || ''
      const innerHtml = el.innerHTML
      const attrs = getCommonAttributes(el, 'card-glass quiz-card')

      return htmlToElement(`
        <div ${attrs}>
          <div class="quiz-badge">随堂思考</div>
          <div class="quiz-question">${question}</div>
          <div class="quiz-options">${innerHtml}</div>
        </div>
      `)
    }

    case 'ui-option': {
      const label = el.getAttribute('label') || 'A'
      const innerHtml = el.innerHTML
      const attrs = getCommonAttributes(el, 'quiz-option')

      return htmlToElement(`
        <div ${attrs}>
          <span class="quiz-option-label">${label}</span>
          <span class="quiz-option-text">${innerHtml}</span>
        </div>
      `)
    }

    case 'ui-badge': {
      const color = el.getAttribute('color') || 'seal'
      const innerHtml = el.innerHTML
      const attrs = getCommonAttributes(el, `badge-pill badge-${color}`)

      return htmlToElement(`<span ${attrs}>${innerHtml}</span>`)
    }

    default:
      return el
  }
}

/** 展开 HTML 片段中的所有 <ui-*> 自定义组件 */
export function expandClassroomComponents(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return html
  }

  // 若不含自定义标签快速返回
  if (!html.includes('<ui-')) {
    return html
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html')
    const root = doc.body.firstElementChild
    if (!root) return html

    // 支持嵌套组件自底向上（从叶子到根）展开
    const customSelectors = [
      'ui-step',
      'ui-option',
      'ui-badge',
      'ui-card',
      'ui-split',
      'ui-split-3',
      'ui-grid-2x2',
      'ui-concept',
      'ui-formula',
      'ui-code',
      'ui-compare',
      'ui-steps',
      'ui-stat',
      'ui-callout',
      'ui-quote',
      'ui-quiz',
    ].join(', ')

    let loopLimit = 10
    while (loopLimit-- > 0) {
      const customElements = root.querySelectorAll(customSelectors)
      if (customElements.length === 0) break

      // 从后往前处理，保证子节点先展开
      for (let i = customElements.length - 1; i >= 0; i--) {
        const customEl = customElements[i]
        const transformed = transformCustomElement(customEl)
        if (transformed !== customEl && customEl.parentNode) {
          customEl.parentNode.replaceChild(transformed, customEl)
        }
      }
    }

    return root.innerHTML
  } catch (err) {
    console.warn('[components] 自定义组件展开失败', err)
    return html
  }
}

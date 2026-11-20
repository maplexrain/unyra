/**
 * 互动课堂预置语义组件库 (components.ts)
 * 将 31 种高阶教学语义标签 (<ui-card>, <ui-concept>, <ui-pipeline>, <ui-diagram> 等)
 * 展开为精细雕琢的舞台 DOM 结构，自动透传 id / data-hidden / data-anim / data-sfx。
 */

import { getClassroomComponent, listClassroomComponents } from './registry'
import { CLASSROOM_ICONS, escapeAttr, getCommonAttributes, htmlToElement } from './componentIcons'
import { transformExtendedElement } from './componentsExtended'

const SPLIT_RATIOS: Record<string, string> = {
  '1:1': '1fr 1fr',
  '3:2': '3fr 2fr',
  '2:3': '2fr 3fr',
  '1:2': '1fr 2fr',
  '2:1': '2fr 1fr',
}

function toneBadgeColor(tone: string, fallback: string): string {
  if (tone === 'warn' || tone === 'ok' || tone === 'seal' || tone === 'sky' || tone === 'purple') {
    return tone
  }
  return fallback
}

/** 展开单一自定义组件节点 */
function transformCustomElement(el: Element): Element {
  const tagName = el.tagName.toLowerCase()

  switch (tagName) {
    case 'ui-card': {
      const title = el.getAttribute('title') || ''
      const subtitle = el.getAttribute('subtitle') || ''
      const eyebrow = el.getAttribute('eyebrow') || ''
      const badge = el.getAttribute('badge') || ''
      const badgeColor = el.getAttribute('badge-color') || 'seal'
      const tone = el.getAttribute('tone') || 'default'
      const footer = el.getAttribute('footer') || ''
      const explicitIcon = el.getAttribute('icon')
      const iconKey = explicitIcon || 'bulb'
      const iconSvg = CLASSROOM_ICONS[iconKey] || CLASSROOM_ICONS.sparkles
      const attrs = getCommonAttributes(el, `card-glass card-ui card-tone-${tone}`)
      const showHeader = Boolean(title || eyebrow || subtitle || badge || explicitIcon)

      return htmlToElement(`
        <div ${attrs}>
          ${showHeader ? `
            <div class="card-ui-header">
              <div class="card-ui-title-group">
                <span class="card-ui-icon">${iconSvg}</span>
                <div class="card-ui-title-box">
                  ${eyebrow ? `<span class="stage-eyebrow">${eyebrow}</span>` : ''}
                  ${title ? `<h3 class="card-ui-title">${title}</h3>` : ''}
                  ${subtitle ? `<span class="card-ui-subtitle">${subtitle}</span>` : ''}
                </div>
              </div>
              ${badge ? `<span class="badge-pill badge-${badgeColor}">${badge}</span>` : ''}
            </div>
          ` : ''}
          <div class="card-ui-body">${el.innerHTML}</div>
          ${footer ? `<div class="card-ui-footer">${footer}</div>` : ''}
        </div>
      `)
    }

    case 'ui-split': {
      const gap = el.getAttribute('gap') || '44'
      const ratio = el.getAttribute('ratio') || '1:1'
      const cols = SPLIT_RATIOS[ratio] || '1fr 1fr'
      const attrs = getCommonAttributes(el, 'stage-split', `gap: ${gap}px; grid-template-columns: ${cols}`)
      return htmlToElement(`<div ${attrs}>${el.innerHTML}</div>`)
    }

    case 'ui-split-3': {
      const gap = el.getAttribute('gap') || '32'
      const attrs = getCommonAttributes(el, 'stage-split-3', `gap: ${gap}px`)
      return htmlToElement(`<div ${attrs}>${el.innerHTML}</div>`)
    }

    case 'ui-grid-2x2': {
      const gap = el.getAttribute('gap') || '32'
      const attrs = getCommonAttributes(el, 'stage-grid-2x2', `gap: ${gap}px`)
      return htmlToElement(`<div ${attrs}>${el.innerHTML}</div>`)
    }

    case 'ui-concept': {
      const term = el.getAttribute('term') || ''
      const en = el.getAttribute('en') || ''
      const tag = el.getAttribute('tag') || ''
      const tagColor = el.getAttribute('tag-color') || 'seal'
      const definition = el.getAttribute('definition') || el.innerHTML || ''
      const keypoint = el.getAttribute('keypoint') || ''
      const attrs = getCommonAttributes(el, 'card-glass concept-card')

      return htmlToElement(`
        <div ${attrs}>
          <div class="concept-header">
            <div class="concept-term-wrap">
              <span class="concept-term">${term}</span>
              ${en ? `<span class="concept-en">${en}</span>` : ''}
            </div>
            ${tag ? `<span class="badge-pill badge-${tagColor}">${tag}</span>` : ''}
          </div>
          <div class="concept-def">${definition}</div>
          ${keypoint ? `
            <div class="concept-keypoint">
              <span class="concept-keypoint-icon">${CLASSROOM_ICONS.sparkles}</span>
              <span class="concept-keypoint-tag">核心要点</span>
              <span class="concept-keypoint-text">${keypoint}</span>
            </div>
          ` : ''}
        </div>
      `)
    }

    case 'ui-formula': {
      const attrLatex = el.getAttribute('latex')
      const latex = (attrLatex !== null ? attrLatex : el.textContent) || ''
      const title = el.getAttribute('title') || ''
      const eyebrow = el.getAttribute('eyebrow') || ''
      const desc = el.getAttribute('desc') || ''
      const tone = el.getAttribute('tone') || 'seal'
      const extraNotes = attrLatex !== null ? el.innerHTML.trim() : ''
      const attrs = getCommonAttributes(el, `card-glass formula-card formula-tone-${tone}`)

      return htmlToElement(`
        <div ${attrs}>
          ${(eyebrow || title) ? `
            <div class="formula-head">
              ${eyebrow ? `<span class="stage-eyebrow">${eyebrow}</span>` : ''}
              ${title ? `<div class="formula-title">${title}</div>` : ''}
            </div>
          ` : ''}
          <div class="formula-box">
            <span class="formula-corner tl" aria-hidden="true"></span>
            <span class="formula-corner tr" aria-hidden="true"></span>
            <span class="formula-corner bl" aria-hidden="true"></span>
            <span class="formula-corner br" aria-hidden="true"></span>
            <div class="formula-math">$$${latex.trim()}$$</div>
          </div>
          ${desc ? `<div class="formula-desc">${desc}</div>` : ''}
          ${extraNotes ? `<div class="formula-notes">${extraNotes}</div>` : ''}
        </div>
      `)
    }

    case 'ui-code': {
      const lang = el.getAttribute('lang') || 'code'
      const title = el.getAttribute('title') || ''
      const caption = el.getAttribute('caption') || ''
      const rawCode = el.innerHTML.replace(/^\n+|\n+$/g, '')
      const attrs = getCommonAttributes(el, 'code-card')

      return htmlToElement(`
        <div ${attrs}>
          <div class="code-header">
            <span class="code-dots" aria-hidden="true"><i class="dot-r"></i><i class="dot-y"></i><i class="dot-g"></i></span>
            <span class="code-title">${title || lang}</span>
            <span class="code-lang">${lang}</span>
          </div>
          <pre class="code-content"><code>${rawCode}</code></pre>
          ${caption ? `<div class="code-caption">${caption}</div>` : ''}
        </div>
      `)
    }

    case 'ui-compare': {
      const leftTitle = el.getAttribute('left-title') || '方案 A'
      const leftBadge = el.getAttribute('left-badge') || ''
      const leftTone = el.getAttribute('left-tone') || 'warn'
      const rightTitle = el.getAttribute('right-title') || '方案 B'
      const rightBadge = el.getAttribute('right-badge') || ''
      const rightTone = el.getAttribute('right-tone') || 'ok'
      const vsText = el.getAttribute('vs') || 'VS'
      const attrs = getCommonAttributes(el, 'card-glass compare-card')

      const leftSlot = el.querySelector('[slot="left"]')?.innerHTML || ''
      const rightSlot = el.querySelector('[slot="right"]')?.innerHTML || ''
      const fallbackChildren = Array.from(el.children).filter((c) => !c.hasAttribute('slot'))
      const leftContent = leftSlot || (fallbackChildren[0] ? fallbackChildren[0].outerHTML : '')
      const rightContent = rightSlot || (fallbackChildren[1] ? fallbackChildren[1].outerHTML : '')

      return htmlToElement(`
        <div ${attrs}>
          <div class="compare-col compare-left compare-tone-${leftTone}">
            <div class="compare-header">
              <span class="compare-title">${leftTitle}</span>
              ${leftBadge ? `<span class="badge-pill badge-${toneBadgeColor(leftTone, 'sky')}">${leftBadge}</span>` : ''}
            </div>
            <div class="compare-body">${leftContent}</div>
          </div>
          <div class="compare-divider">
            <span class="compare-line" aria-hidden="true"></span>
            <span class="compare-badge">${vsText}</span>
            <span class="compare-line" aria-hidden="true"></span>
          </div>
          <div class="compare-col compare-right compare-tone-${rightTone}">
            <div class="compare-header">
              <span class="compare-title">${rightTitle}</span>
              ${rightBadge ? `<span class="badge-pill badge-${toneBadgeColor(rightTone, 'seal')}">${rightBadge}</span>` : ''}
            </div>
            <div class="compare-body">${rightContent}</div>
          </div>
        </div>
      `)
    }

    case 'ui-steps': {
      const title = el.getAttribute('title') || ''
      const subtitle = el.getAttribute('subtitle') || ''
      const attrs = getCommonAttributes(el, 'steps-flow')

      return htmlToElement(`
        <div ${attrs}>
          ${(title || subtitle) ? `
            <div class="steps-head">
              ${title ? `<div class="steps-title">${title}</div>` : ''}
              ${subtitle ? `<div class="steps-subtitle">${subtitle}</div>` : ''}
            </div>
          ` : ''}
          <div class="steps-container">${el.innerHTML}</div>
        </div>
      `)
    }

    case 'ui-step': {
      const num = el.getAttribute('num') || '1'
      const title = el.getAttribute('title') || ''
      const badge = el.getAttribute('badge') || ''
      const state = el.getAttribute('state') || 'default'
      const attrs = getCommonAttributes(el, `step-item step-state-${state}`)

      return htmlToElement(`
        <div ${attrs}>
          <div class="step-rail">
            <div class="step-num">${num}</div>
            <div class="step-line" aria-hidden="true"></div>
          </div>
          <div class="step-content">
            ${(title || badge) ? `
              <div class="step-head-row">
                ${title ? `<div class="step-title">${title}</div>` : ''}
                ${badge ? `<span class="badge-pill badge-${state === 'warn' ? 'warn' : state === 'done' ? 'ok' : 'seal'} badge-sm">${badge}</span>` : ''}
              </div>
            ` : ''}
            <div class="step-desc">${el.innerHTML}</div>
          </div>
        </div>
      `)
    }

    case 'ui-stat': {
      const value = el.getAttribute('value') || '0'
      const prefix = el.getAttribute('prefix') || ''
      const suffix = el.getAttribute('suffix') || ''
      const label = el.getAttribute('label') || ''
      const delta = el.getAttribute('delta') || ''
      const subtext = el.getAttribute('subtext') || ''
      const tone = el.getAttribute('tone') || 'seal'
      const iconKey = el.getAttribute('icon') || 'chart'
      const iconSvg = CLASSROOM_ICONS[iconKey] || CLASSROOM_ICONS.chart
      const attrs = getCommonAttributes(el, `card-glass stat-card stat-tone-${tone}`)
      const cleanNum = value.replace(/,/g, '').trim()
      const isNumeric = /^[+-]?\d+(\.\d+)?$/.test(cleanNum)

      return htmlToElement(`
        <div ${attrs}>
          <div class="stat-top">
            <div class="stat-label-wrap">
              <span class="stat-icon">${iconSvg}</span>
              <span class="stat-label">${label}</span>
            </div>
            ${delta ? `<span class="stat-delta">${delta}</span>` : ''}
          </div>
          <div class="stat-value-box">
            ${prefix ? `<span class="stat-affix">${prefix}</span>` : ''}
            <span class="stat-value"${
              isNumeric
                ? ` data-anim="countUp" data-target="${escapeAttr(cleanNum)}" data-suffix="${escapeAttr(suffix)}"`
                : ''
            }>${value}${!isNumeric && suffix ? suffix : ''}</span>
          </div>
          ${subtext ? `<div class="stat-subtext">${subtext}</div>` : ''}
        </div>
      `)
    }

    case 'ui-callout': {
      const type = el.getAttribute('type') || 'tip'
      const badge = el.getAttribute('badge') || ''
      const defaultTitle =
        type === 'warn' ? '重要提醒' : type === 'danger' ? '严禁误区' : type === 'info' ? '背景补充' : type === 'insight' ? '核心洞察' : '重点提示'
      const title = el.getAttribute('title') || defaultTitle
      const iconKey = type === 'warn' || type === 'danger' ? 'warn' : type === 'info' ? 'info' : type === 'insight' ? 'sparkles' : 'bulb'
      const iconSvg = CLASSROOM_ICONS[iconKey] || CLASSROOM_ICONS.bulb
      const badgeColor = type === 'warn' || type === 'danger' ? 'warn' : type === 'info' ? 'sky' : 'seal'
      const attrs = getCommonAttributes(el, `callout-card callout-${type}`)

      return htmlToElement(`
        <div ${attrs}>
          <div class="callout-header">
            <span class="callout-icon">${iconSvg}</span>
            <span class="callout-title">${title}</span>
            ${badge ? `<span class="badge-pill badge-${badgeColor} badge-sm">${badge}</span>` : ''}
          </div>
          <div class="callout-body">${el.innerHTML}</div>
        </div>
      `)
    }

    case 'ui-quote': {
      const quote = el.getAttribute('quote') || el.innerHTML || ''
      const author = el.getAttribute('author') || ''
      const role = el.getAttribute('role') || ''
      const source = el.getAttribute('source') || ''
      const attrs = getCommonAttributes(el, 'card-glass quote-card')

      return htmlToElement(`
        <div ${attrs}>
          <div class="quote-mark" aria-hidden="true">“</div>
          <blockquote class="quote-text">${quote}</blockquote>
          ${(author || source) ? `
            <div class="quote-meta">
              ${author ? `<span class="quote-author">—— ${author}</span>` : ''}
              ${role ? `<span class="quote-role">${role}</span>` : ''}
              ${source ? `<span class="quote-source">《${source}》</span>` : ''}
            </div>
          ` : ''}
        </div>
      `)
    }

    case 'ui-quiz': {
      const question = el.getAttribute('question') || ''
      const badge = el.getAttribute('badge') || '随堂思辨'
      const hint = el.getAttribute('hint') || ''
      const attrs = getCommonAttributes(el, 'card-glass quiz-card')

      return htmlToElement(`
        <div ${attrs}>
          <div class="quiz-head">
            <div class="quiz-badge">${badge}</div>
          </div>
          <div class="quiz-question">${question}</div>
          <div class="quiz-options">${el.innerHTML}</div>
          ${hint ? `<div class="quiz-hint">${hint}</div>` : ''}
        </div>
      `)
    }

    case 'ui-option': {
      const label = el.getAttribute('label') || 'A'
      const state = el.getAttribute('state') || 'default'
      const attrs = getCommonAttributes(el, `quiz-option quiz-option-${state}`)

      return htmlToElement(`
        <div ${attrs}>
          <span class="quiz-option-label">${label}</span>
          <span class="quiz-option-text">${el.innerHTML}</span>
        </div>
      `)
    }

    case 'ui-badge': {
      const color = el.getAttribute('color') || 'seal'
      const variant = el.getAttribute('variant') || 'soft'
      const attrs = getCommonAttributes(el, `badge-pill badge-${color} badge-variant-${variant}`)
      return htmlToElement(`<span ${attrs}>${el.innerHTML}</span>`)
    }

    default: {
      const extended = transformExtendedElement(el)
      if (extended) return extended

      const customDef = getClassroomComponent(tagName)
      if (customDef && customDef.template) {
        let tpl = customDef.template
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i]
          tpl = tpl.replace(new RegExp(`\\{\\{${attr.name}\\}\\}`, 'g'), attr.value)
        }
        if (customDef.defaultProps) {
          for (const [k, v] of Object.entries(customDef.defaultProps)) {
            tpl = tpl.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v)
          }
        }
        tpl = tpl.replace(/\{\{(content|children)\}\}/g, el.innerHTML)
        const attrs = getCommonAttributes(el)
        return htmlToElement(`<div ${attrs}>${tpl}</div>`)
      }
      return el
    }
  }
}

/** 展开 HTML 片段中的所有 <ui-*> 与自定义组件 */
export function expandClassroomComponents(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return html
  }

  if (!html.includes('<ui-') && !html.includes('<x-')) {
    return html
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html')
    const root = doc.body.firstElementChild
    if (!root) return html

    const allDefs = listClassroomComponents()
    const customSelectors = Array.from(
      new Set([
        'ui-step',
        'ui-option',
        'ui-badge',
        'ui-node',
        'ui-timeline-item',
        'ui-speech',
        'ui-accordion-item',
        'ui-card',
        'ui-split',
        'ui-split-3',
        'ui-grid-2x2',
        'ui-pipeline',
        'ui-diagram',
        'ui-breakdown',
        'ui-concept',
        'ui-formula',
        'ui-code',
        'ui-compare',
        'ui-steps',
        'ui-stat',
        'ui-callout',
        'ui-quote',
        'ui-quiz',
        'ui-banner',
        ...allDefs.map((d) => d.tag.toLowerCase()),
      ]),
    ).join(', ')

    let loopLimit = 10
    while (loopLimit-- > 0) {
      const customElements = root.querySelectorAll(customSelectors)
      if (customElements.length === 0) break

      // 从后往前展开，保证叶子节点先完成展开
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

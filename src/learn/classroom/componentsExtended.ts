/**
 * 课堂扩展语义组件展开器 (componentsExtended.ts)
 * 负责 banner / pipeline / diagram / breakdown / timeline / progress / dialogue / table / keyboard / highlight / accordion。
 */
import { CLASSROOM_ICONS, escapeAttr, getCommonAttributes, htmlToElement } from './componentIcons'

function toneBadgeColor(tone: string, fallback: string): string {
  if (tone === 'warn' || tone === 'ok' || tone === 'seal' || tone === 'sky' || tone === 'purple') {
    return tone
  }
  return fallback
}

export function transformExtendedElement(el: Element): Element | null {
  const tagName = el.tagName.toLowerCase()

  switch (tagName) {
    case 'ui-banner': {
      const title = el.getAttribute('title') || ''
      const subtitle = el.getAttribute('subtitle') || ''
      const eyebrow = el.getAttribute('eyebrow') || ''
      const badge = el.getAttribute('badge') || ''
      const badgeColor = el.getAttribute('badge-color') || el.getAttribute('tone') || 'seal'
      const tone = el.getAttribute('tone') || 'seal'
      const align = el.getAttribute('align') === 'left' ? 'left' : 'center'
      const attrs = getCommonAttributes(el, `stage-banner banner-tone-${tone} banner-align-${align}`)

      return htmlToElement(`
        <div ${attrs}>
          <div class="banner-aura" aria-hidden="true"></div>
          ${(eyebrow || badge) ? `
            <div class="banner-meta">
              ${eyebrow ? `<span class="stage-eyebrow">${eyebrow}</span>` : ''}
              ${badge ? `<span class="badge-pill badge-${badgeColor}">${badge}</span>` : ''}
            </div>
          ` : ''}
          <h2 class="banner-title">${title}</h2>
          ${subtitle ? `<p class="banner-subtitle">${subtitle}</p>` : ''}
        </div>
      `)
    }

    case 'ui-pipeline': {
      const title = el.getAttribute('title') || ''
      const subtitle = el.getAttribute('subtitle') || ''
      const direction = el.getAttribute('direction') === 'column' ? 'column' : 'row'
      const attrs = getCommonAttributes(el, `card-glass pipeline-flow pipeline-${direction}`)
      return htmlToElement(`
        <div ${attrs}>
          ${(title || subtitle) ? `
            <div class="pipeline-header">
              ${title ? `<div class="pipeline-title">${title}</div>` : ''}
              ${subtitle ? `<div class="pipeline-subtitle">${subtitle}</div>` : ''}
            </div>
          ` : ''}
          <div class="pipeline-track">${el.innerHTML}</div>
        </div>
      `)
    }

    case 'ui-node': {
      const step = el.getAttribute('step') || ''
      const title = el.getAttribute('title') || ''
      const badge = el.getAttribute('badge') || ''
      const tone = el.getAttribute('tone') || 'default'
      const iconKey = el.getAttribute('icon')
      const iconSvg = iconKey ? CLASSROOM_ICONS[iconKey] || CLASSROOM_ICONS.layers : ''
      const attrs = getCommonAttributes(el, `pipeline-node pipeline-tone-${tone}`)

      return htmlToElement(`
        <div ${attrs}>
          <div class="pipeline-node-head">
            ${step ? `<span class="pipeline-step-num">${step}</span>` : ''}
            ${iconSvg ? `<span class="pipeline-node-icon">${iconSvg}</span>` : ''}
            ${badge ? `<span class="badge-pill badge-${toneBadgeColor(tone, 'seal')} badge-sm">${badge}</span>` : ''}
          </div>
          ${title ? `<div class="pipeline-node-title">${title}</div>` : ''}
          <div class="pipeline-node-body">${el.innerHTML}</div>
        </div>
      `)
    }

    case 'ui-diagram': {
      const title = el.getAttribute('title') || ''
      const eyebrow = el.getAttribute('eyebrow') || ''
      const caption = el.getAttribute('caption') || ''
      const grid = el.getAttribute('grid') || 'dots'
      const tone = el.getAttribute('tone') || 'default'
      const attrs = getCommonAttributes(el, `card-glass diagram-card diagram-grid-${grid} card-tone-${tone}`)

      return htmlToElement(`
        <div ${attrs}>
          ${(eyebrow || title) ? `
            <div class="diagram-head">
              ${eyebrow ? `<span class="stage-eyebrow">${eyebrow}</span>` : ''}
              ${title ? `<div class="diagram-title">${title}</div>` : ''}
            </div>
          ` : ''}
          <div class="diagram-viewport">${el.innerHTML}</div>
          ${caption ? `<div class="diagram-caption">${caption}</div>` : ''}
        </div>
      `)
    }

    case 'ui-breakdown': {
      const title = el.getAttribute('title') || ''
      const subtitle = el.getAttribute('subtitle') || ''
      const total = el.getAttribute('total') || ''
      const itemsAttr = el.getAttribute('items') || ''
      const attrs = getCommonAttributes(el, 'card-glass breakdown-card')

      type Seg = { label: string; value: number; color: string }
      const segments: Seg[] = []
      if (itemsAttr.trim()) {
        for (const chunk of itemsAttr.split(',')) {
          const [lbl, valStr, clr] = chunk.split(':').map((s) => s.trim())
          if (!lbl) continue
          const num = parseFloat(valStr || '0')
          segments.push({ label: lbl, value: Number.isFinite(num) && num > 0 ? num : 0, color: clr || 'seal' })
        }
      } else {
        Array.from(el.children).forEach((child) => {
          const lbl = child.getAttribute('data-label') || child.textContent?.trim() || ''
          const valStr = child.getAttribute('data-value') || '0'
          const clr = child.getAttribute('data-color') || 'seal'
          const num = parseFloat(valStr)
          if (lbl) segments.push({ label: lbl, value: Number.isFinite(num) && num > 0 ? num : 0, color: clr })
        })
      }

      const sum = segments.reduce((acc, s) => acc + s.value, 0) || 1
      const barsHtml = segments
        .map((s) => {
          const w = Math.max(2, Math.round((s.value / sum) * 1000) / 10)
          return `<div class="breakdown-seg breakdown-color-${escapeAttr(s.color)}" style="width: ${w}%"></div>`
        })
        .join('')
      const legendHtml = segments
        .map((s) => {
          const pct = Math.round((s.value / sum) * 100)
          return `
            <div class="breakdown-legend-item">
              <span class="breakdown-dot breakdown-color-${escapeAttr(s.color)}"></span>
              <span class="breakdown-legend-label">${s.label}</span>
              <strong class="breakdown-legend-val">${pct}%</strong>
            </div>
          `
        })
        .join('')

      return htmlToElement(`
        <div ${attrs}>
          ${(title || total || subtitle) ? `
            <div class="breakdown-head">
              <div>
                ${title ? `<div class="breakdown-title">${title}</div>` : ''}
                ${subtitle ? `<div class="breakdown-subtitle">${subtitle}</div>` : ''}
              </div>
              ${total ? `<span class="breakdown-total">${total}</span>` : ''}
            </div>
          ` : ''}
          <div class="breakdown-bar">${barsHtml}</div>
          <div class="breakdown-legend">${legendHtml}</div>
        </div>
      `)
    }

    case 'ui-timeline': {
      const title = el.getAttribute('title') || ''
      const subtitle = el.getAttribute('subtitle') || ''
      const attrs = getCommonAttributes(el, 'timeline-flow')
      return htmlToElement(`
        <div ${attrs}>
          ${(title || subtitle) ? `
            <div class="timeline-head">
              ${title ? `<div class="timeline-title">${title}</div>` : ''}
              ${subtitle ? `<div class="timeline-subtitle">${subtitle}</div>` : ''}
            </div>
          ` : ''}
          <div class="timeline-container">${el.innerHTML}</div>
        </div>
      `)
    }

    case 'ui-timeline-item': {
      const time = el.getAttribute('time') || ''
      const title = el.getAttribute('title') || ''
      const badge = el.getAttribute('badge') || ''
      const color = el.getAttribute('color') || 'seal'
      const attrs = getCommonAttributes(el, `timeline-item timeline-tone-${color}`)
      return htmlToElement(`
        <div ${attrs}>
          <div class="timeline-node">
            <div class="timeline-dot"></div>
            <div class="timeline-line" aria-hidden="true"></div>
          </div>
          <div class="timeline-content-box">
            <div class="timeline-header">
              ${time ? `<span class="timeline-time">${time}</span>` : ''}
              ${title ? `<span class="timeline-heading">${title}</span>` : ''}
              ${badge ? `<span class="badge-pill badge-${color} badge-sm">${badge}</span>` : ''}
            </div>
            <div class="timeline-desc">${el.innerHTML}</div>
          </div>
        </div>
      `)
    }

    case 'ui-progress': {
      const value = parseFloat(el.getAttribute('value') || '0')
      const max = parseFloat(el.getAttribute('max') || '100') || 100
      const pct = Math.min(100, Math.max(0, Math.round((value / max) * 100)))
      const label = el.getAttribute('label') || ''
      const desc = el.getAttribute('desc') || ''
      const color = el.getAttribute('color') || 'seal'
      const attrs = getCommonAttributes(el, `card-glass progress-card progress-tone-${color}`)
      return htmlToElement(`
        <div ${attrs}>
          <div class="progress-header">
            <span class="progress-label">${label}</span>
            <span class="progress-val">${pct}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${pct}%"></div>
          </div>
          ${desc ? `<div class="progress-desc">${desc}</div>` : ''}
        </div>
      `)
    }

    case 'ui-dialogue': {
      const title = el.getAttribute('title') || ''
      const attrs = getCommonAttributes(el, 'dialogue-flow')
      return htmlToElement(`
        <div ${attrs}>
          ${title ? `<div class="dialogue-title">${title}</div>` : ''}
          <div class="dialogue-container">${el.innerHTML}</div>
        </div>
      `)
    }

    case 'ui-speech': {
      const role = el.getAttribute('role') || 'teacher'
      const isStudent = role === 'student'
      const name = el.getAttribute('name') || (isStudent ? '探索者' : '导师')
      const avatarChar = el.getAttribute('avatar') || (isStudent ? '问' : '师')
      const attrs = getCommonAttributes(el, `speech-item ${isStudent ? 'speech-item-student' : ''}`)
      return htmlToElement(`
        <div ${attrs}>
          <div class="speech-avatar ${isStudent ? 'avatar-student' : 'avatar-teacher'}">${avatarChar}</div>
          <div class="speech-bubble ${isStudent ? 'bubble-student' : 'bubble-teacher'}">
            <div class="speech-meta">${name}</div>
            <div class="speech-text">${el.innerHTML}</div>
          </div>
        </div>
      `)
    }

    case 'ui-table': {
      const title = el.getAttribute('title') || ''
      const headersStr = el.getAttribute('headers') || ''
      const caption = el.getAttribute('caption') || ''
      const headers = headersStr ? headersStr.split(',').map((h) => h.trim()) : []
      const attrs = getCommonAttributes(el, 'card-glass table-card')
      const theadHtml = headers.length > 0 ? `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` : ''
      const innerTable = el.querySelector(':scope > table')
      const bodyHtml = innerTable
        ? (innerTable.querySelector(':scope > tbody')?.innerHTML ?? innerTable.innerHTML)
        : el.innerHTML
      return htmlToElement(`
        <div ${attrs}>
          ${title ? `<div class="table-title">${title}</div>` : ''}
          <table class="table-classroom">
            ${theadHtml}
            <tbody>${bodyHtml}</tbody>
          </table>
          ${caption ? `<div class="table-caption">${caption}</div>` : ''}
        </div>
      `)
    }

    case 'ui-keyboard': {
      const keysStr = el.getAttribute('keys') || 'Ctrl + P'
      const sep = keysStr.includes('+') ? '+' : ','
      const keys = keysStr.split(sep).map((k) => k.trim()).filter(Boolean)
      const action = el.getAttribute('action') || ''
      const desc = el.getAttribute('desc') || ''
      const attrs = getCommonAttributes(el, 'card-glass kbd-card')
      const keysHtml = keys
        .map(
          (k, idx) =>
            `<kbd class="kbd-key">${k}</kbd>${idx < keys.length - 1 ? '<span class="kbd-plus" aria-hidden="true">+</span>' : ''}`,
        )
        .join('')
      return htmlToElement(`
        <div ${attrs}>
          <div class="kbd-info">
            ${action ? `<span class="kbd-action">${action}</span>` : ''}
            ${desc ? `<span class="kbd-desc">${desc}</span>` : ''}
          </div>
          <div class="kbd-group">${keysHtml}</div>
        </div>
      `)
    }

    case 'ui-highlight': {
      const color = el.getAttribute('color') || 'yellow'
      const attrs = getCommonAttributes(el, `highlight-text highlight-${color}`)
      return htmlToElement(`<mark ${attrs}>${el.innerHTML}</mark>`)
    }

    case 'ui-accordion': {
      const title = el.getAttribute('title') || ''
      const attrs = getCommonAttributes(el, 'accordion-flow')
      return htmlToElement(`
        <div ${attrs}>
          ${title ? `<div class="accordion-title">${title}</div>` : ''}
          <div class="accordion-container">${el.innerHTML}</div>
        </div>
      `)
    }

    case 'ui-accordion-item': {
      const title = el.getAttribute('title') || ''
      const tag = el.getAttribute('tag') || ''
      const isClosed = el.getAttribute('open') === 'false'
      const attrs = getCommonAttributes(el, `accordion-item ${isClosed ? 'is-closed' : 'is-open'}`)
      return htmlToElement(`
        <div ${attrs}>
          <div class="accordion-header">
            <span class="accordion-head-title">${title}</span>
            ${tag ? `<span class="badge-pill badge-seal badge-sm">${tag}</span>` : ''}
          </div>
          ${isClosed ? '' : `<div class="accordion-body">${el.innerHTML}</div>`}
        </div>
      `)
    }

    default:
      return null
  }
}

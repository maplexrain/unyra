/**
 * Typst 内置函数渲染解析器（#align, #text, #block, #table, #raw 等）
 */

import { parseStyleArgs, splitTopLevel } from './scanner'

export interface TypstRenderContext {
  renderSub: (content: string) => string
  renderInline: (text: string) => string
}

/** 渲染单个 Typst 函数调用产物 */
export function renderTypstFunction(
  fn: string,
  args: string | null,
  body: string | null,
  ctx: TypstRenderContext,
): string {
  if (fn === 'align') {
    const alignVal = (args || 'left').trim()
    const alignCls =
      alignVal === 'center'
        ? 'text-center flex flex-col items-center'
        : alignVal === 'right'
          ? 'text-right flex flex-col items-end'
          : 'text-left'
    const innerHtml = body ? ctx.renderSub(body) : ''
    return `<div class="typst-align ${alignCls} my-3 w-full">${innerHtml}</div>`
  }

  if (fn === 'text') {
    const style = parseStyleArgs(args)
    const innerHtml = body ? ctx.renderSub(body) : ''
    return `<span class="typst-text" style="${style}">${innerHtml}</span>`
  }

  if (fn === 'v') {
    const val = (args || '0.5em').replace(/["']/g, '').trim()
    return `<div class="typst-v" style="height: ${val}"></div>`
  }

  if (fn === 'h') {
    const val = (args || '0.5em').replace(/["']/g, '').trim()
    return `<span class="typst-h inline-block" style="width: ${val}"></span>`
  }

  if (fn === 'block' || fn === 'rect') {
    const style = parseStyleArgs(args)
    const innerHtml = body ? ctx.renderSub(body) : ''
    return `<div class="typst-block my-3 rounded-none bg-paper/40 p-3" style="${style}">${innerHtml}</div>`
  }

  if (fn === 'raw') {
    const code = (args || body || '').replace(/^["']|["']$/g, '').trim()
    return `<code class="typst-code font-mono text-[0.88em] px-1.5 py-0.5 rounded bg-line/50 text-seal font-semibold">${code}</code>`
  }

  if (fn === 'link') {
    const parts = splitTopLevel(args || '')
    const url = (parts[0] || '').replace(/["']/g, '').trim()
    const label = body ? ctx.renderInline(body) : url
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-seal underline underline-offset-2 hover:text-seal-deep">${label}</a>`
  }

  if (fn === 'image') {
    const parts = splitTopLevel(args || '')
    const src = (parts[0] || '').replace(/["']/g, '').trim()
    return `<img src="${src}" alt="typst-image" class="typst-img my-3 max-w-full rounded border border-line/60" />`
  }

  if (fn === 'line') {
    return `<hr class="typst-hr my-4 border-line/80" />`
  }

  if (fn === 'table') {
    return renderTypstTable(args, ctx)
  }

  // 基础修饰块：#strong, #emph, #underline, #strike
  if (fn === 'strong') {
    return `<strong class="typst-bold font-bold text-ink-strong">${body ? ctx.renderInline(body) : ''}</strong>`
  }
  if (fn === 'emph') {
    return `<em class="typst-italic italic">${body ? ctx.renderInline(body) : ''}</em>`
  }
  if (fn === 'underline') {
    return `<span class="underline underline-offset-4 decoration-line-strong">${body ? ctx.renderInline(body) : ''}</span>`
  }
  if (fn === 'strike') {
    return `<del class="line-through text-ink-faint">${body ? ctx.renderInline(body) : ''}</del>`
  }

  return body ? ctx.renderSub(body) : ''
}

/** 渲染 Typst 表格 (#table) */
export function renderTypstTable(argsStr: string | null, ctx: TypstRenderContext): string {
  const parts = splitTopLevel(argsStr || '')
  let numCols = 1
  let headerCells: string[] = []
  const bodyCells: string[] = []

  for (const part of parts) {
    if (part.startsWith('columns:')) {
      const cVal = part.slice(8).trim()
      if (cVal.startsWith('(') && cVal.endsWith(')')) {
        numCols = splitTopLevel(cVal.slice(1, -1)).length
      } else if (/^\d+$/.test(cVal)) {
        numCols = parseInt(cVal, 10)
      }
    } else if (part.startsWith('table.header(') && part.endsWith(')')) {
      const hInner = part.slice(13, -1)
      headerCells = splitTopLevel(hInner).map((c) => c.replace(/^\[|\]$/g, '').trim())
    } else if (!part.includes(':')) {
      bodyCells.push(part.replace(/^\[|\]$/g, '').trim())
    }
  }

  let html =
    '<div class="typst-table-wrap my-4 overflow-x-auto"><table class="typst-table w-full border-collapse border border-line text-[12.5px]">'

  if (headerCells.length > 0) {
    html += '<thead><tr class="border-b border-line-strong bg-paper/80 font-bold">'
    for (const h of headerCells) {
      html += `<th class="p-2.5 text-left border border-line">${ctx.renderInline(h)}</th>`
    }
    html += '</tr></thead>'
  }

  html += '<tbody>'
  for (let r = 0; r < bodyCells.length; r += numCols) {
    html += '<tr class="border-b border-line/40 hover:bg-line/20">'
    for (let c = 0; c < numCols; c++) {
      const cell = bodyCells[r + c] || ''
      html += `<td class="p-2 border border-line/50">${ctx.renderInline(cell)}</td>`
    }
    html += '</tr>'
  }
  html += '</tbody></table></div>'

  return html
}

/**
 * quote 块 DOM 挂载与交互。
 *
 * 职责：占位容器提交 DOM 后的异步 hydrate（hydrateQuotes）——
 * 文件内容读取与内存缓存（fetchQuoteFile / quoteFileCache）、
 * 相邻同文件引用块合并（mergeAdjacentQuoteElements / parseSectionsAttr）、
 * comment 注解悬浮提示气泡（attachCommentTooltips）、
 * 语法高亮渲染行号跳转 / 复制 / 打开事件绑定。
 */
import { t } from '../../i18n'
import { decodeAttr, encodeAttr } from '../renderPlugins'
import { highlight, type HighlightToken } from '../../syntax/SyntaxHighlighter'
import { quoteBlockHost, subscribeQuoteBlockHost } from './host'
import { detectLanguageFromPath, renderQuotedLines } from './render'
import { formatSectionsBadge, type QuoteBlockHost, type QuoteMappingRule, type QuoteSection } from './types'

/** 内存缓存文件内容，避免频繁重复读取磁盘 */
const quoteFileCache = new Map<string, { content: string | null; at: number }>()
const inFlightFileReads = new Map<string, Promise<string | null>>()
const CACHE_TTL_MS = 10_000

async function fetchQuoteFile(host: QuoteBlockHost, filePath: string): Promise<string | null> {
  const now = Date.now()
  const cached = quoteFileCache.get(filePath)
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.content
  }

  const existing = inFlightFileReads.get(filePath)
  if (existing) return existing

  const req = (async () => {
    try {
      const content = await host.readFile(filePath)
      quoteFileCache.set(filePath, { content, at: Date.now() })
      return content
    } catch (err) {
      console.warn('[quoteBlock] readFile error', filePath, err)
      quoteFileCache.set(filePath, { content: null, at: Date.now() })
      return null
    } finally {
      inFlightFileReads.delete(filePath)
    }
  })()

  inFlightFileReads.set(filePath, req)
  return req
}

/** 从 DOM item 中解析出当前引用的所有区间 (sections) */
function parseSectionsAttr(item: HTMLElement): QuoteSection[] {
  try {
    const rawSec = item.getAttribute('data-sections') ?? item.dataset.sections
    if (rawSec) {
      const parsed = JSON.parse(decodeAttr(rawSec))
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as QuoteSection[]
      }
    }
  } catch {}

  const startLine = parseInt(item.dataset.start ?? '1', 10)
  const endLine = parseInt(item.dataset.end ?? '1', 10)
  let rules: QuoteMappingRule[] = []
  try {
    const rawRules = item.getAttribute('data-rules') ?? item.dataset.rules ?? '[]'
    rules = JSON.parse(decodeAttr(rawRules)) as QuoteMappingRule[]
  } catch {
    rules = []
  }
  return [{ startLine, endLine, rules }]
}

/** 合并 DOM 中相邻且引用同一文件的 quote 块 */
function mergeAdjacentQuoteElements(root: HTMLElement): void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.moji-quote-block'))
  for (let i = 0; i < blocks.length; i++) {
    const curBlock = blocks[i]
    if (!curBlock.isConnected) continue

    let nextNode = curBlock.nextSibling
    while (nextNode && nextNode.nodeType === Node.TEXT_NODE && !nextNode.textContent?.trim()) {
      nextNode = nextNode.nextSibling
    }

    if (nextNode && nextNode.nodeType === Node.ELEMENT_NODE) {
      const nextEl = nextNode as HTMLElement
      if (nextEl.classList.contains('moji-quote-block')) {
        const curItems = Array.from(curBlock.querySelectorAll<HTMLElement>('.moji-quote-item'))
        const nextItems = Array.from(nextEl.querySelectorAll<HTMLElement>('.moji-quote-item'))
        if (curItems.length > 0 && nextItems.length > 0) {
          const lastCurItem = curItems[curItems.length - 1]
          const firstNextItem = nextItems[0]

          const file1 = lastCurItem.getAttribute('data-file')
          const file2 = firstNextItem.getAttribute('data-file')

          if (file1 && file1 === file2) {
            const sec1 = parseSectionsAttr(lastCurItem)
            const sec2 = parseSectionsAttr(firstNextItem)
            const mergedSecs = [...sec1, ...sec2]

            lastCurItem.setAttribute('data-sections', encodeAttr(JSON.stringify(mergedSecs)))
            const badgeEl = lastCurItem.querySelector('.moji-quote-badge')
            if (badgeEl) {
              badgeEl.textContent = formatSectionsBadge(mergedSecs)
            }

            firstNextItem.remove()

            // 将 nextEl 剩余的所有子节点（若有）合并移动到 curBlock
            const remaining = Array.from(nextEl.children)
            for (const child of remaining) {
              curBlock.appendChild(child)
            }
            nextEl.remove()

            // 重新检验合并后的当前块
            i--
          }
        }
      }
    }
  }
}

let activeQuoteTip: HTMLElement | null = null

function removeActiveQuoteTip(): void {
  if (activeQuoteTip) {
    activeQuoteTip.remove()
    activeQuoteTip = null
  }
}

/** 为所有被 comment 标注的文本绑定鼠标悬浮提示气泡 */
function attachCommentTooltips(container: HTMLElement): void {
  const commentEls = container.querySelectorAll<HTMLElement>('.moji-quote-comment')
  for (const el of commentEls) {
    const comment = el.dataset.comment || el.getAttribute('title') || ''
    if (!comment) continue

    el.addEventListener('mouseenter', () => {
      removeActiveQuoteTip()
      el.removeAttribute('title')

      const tip = document.createElement('div')
      tip.className =
        'moji-quote-tip fixed z-50 max-w-xs px-2.5 py-1.5 text-xs text-ink bg-card border border-line-strong/80 shadow-lg rounded-none pointer-events-none select-none transition-opacity duration-150'
      tip.textContent = comment

      document.body.appendChild(tip)
      activeQuoteTip = tip

      const rect = el.getBoundingClientRect()
      const tipRect = tip.getBoundingClientRect()

      let left = rect.left + rect.width / 2 - tipRect.width / 2
      const vw = typeof window !== 'undefined' ? (window.innerWidth || 1024) : 1024
      left = Math.max(8, Math.min(left, vw - tipRect.width - 8))

      let top = rect.top - tipRect.height - 6
      if (top < 8) {
        top = rect.bottom + 6
      }

      tip.style.left = `${Math.round(left)}px`
      tip.style.top = `${Math.round(top)}px`
    })

    el.addEventListener('mouseleave', () => {
      el.setAttribute('title', comment)
      removeActiveQuoteTip()
    })
  }
}

/**
 * DOM 提交后异步挂载原文引用与交互事件
 */
export function hydrateQuotes(root: HTMLElement): () => void {
  let unsub: (() => void) | null = null

  // 1. 合并相邻且引用同一文件的 quote 块
  mergeAdjacentQuoteElements(root)

  const run = () => {
    const items = root.querySelectorAll<HTMLElement>('.moji-quote-item:not([data-hydrated="true"])')
    if (!items.length) return

    const host = quoteBlockHost()
    if (!host) {
      if (!unsub) {
        unsub = subscribeQuoteBlockHost(() => {
          run()
        })
      }
      return
    }

    if (unsub) {
      unsub()
      unsub = null
    }

    for (const item of items) {
      if (item.dataset.hydrated === 'true') continue

      const rawFile = item.getAttribute('data-file') ?? item.dataset.file ?? ''
      let filePath = decodeAttr(rawFile)
      try {
        if (filePath.includes('%')) {
          filePath = decodeURIComponent(filePath)
        }
      } catch {}

      const sections = parseSectionsAttr(item)
      const firstStart = sections[0]?.startLine ?? 1
      const lastEnd = sections[sections.length - 1]?.endLine ?? firstStart

      const bodyEl = item.querySelector<HTMLElement>('.moji-quote-body')
      const pathBtn = item.querySelector<HTMLElement>('.moji-quote-path')
      const openBtn = item.querySelector<HTMLElement>('.moji-quote-open')
      const copyBtn = item.querySelector<HTMLElement>('.moji-quote-copy')

      const handleOpen = () => {
        if (host.onOpenFile) {
          host.onOpenFile(filePath, firstStart, lastEnd)
        }
      }

      if (pathBtn) pathBtn.onclick = handleOpen
      if (openBtn) openBtn.onclick = handleOpen

      void fetchQuoteFile(host, filePath).then(async (content) => {
        item.dataset.hydrated = 'true'
        if (!bodyEl) return

        if (content === null || content === undefined) {
          const displayFailedPath = filePath || '未知路径'
          bodyEl.innerHTML =
            `<div class="flex items-start gap-2 text-xs text-ink-faint rounded-none whitespace-pre-wrap break-words break-all">` +
            `<svg class="w-4 h-4 text-ink-faint shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">` +
            `<circle cx="12" cy="12" r="10" stroke-width="1.5"/>` +
            `<path stroke-width="1.5" d="m15 9-6 6m0-6 6 6"/>` +
            `</svg>` +
            `<span>${t('无法读取引用的源文件（{0}）', displayFailedPath)}</span>` +
            `</div>`
          return
        }

        // 代码语法高亮（根据文件后缀嗅探语言）
        let tokenLines: HighlightToken[][] | undefined = undefined
        const langId = detectLanguageFromPath(filePath)
        if (langId) {
          try {
            const highlighted = await highlight(content, langId)
            if (!highlighted.plain && highlighted.lines.length > 0) {
              tokenLines = highlighted.lines
            }
          } catch (err) {
            console.warn('[quoteBlock] highlight error', err)
          }
        }

        // 对每一个引用区间分别渲染行与规则
        const renderedSections: Array<{
          startLine: number
          endLine: number
          lines: Array<{ lineNum: number; html: string; raw: string }>
        }> = []

        for (const sec of sections) {
          const lines = renderQuotedLines(content, sec.startLine, sec.endLine, sec.rules, tokenLines)
          if (lines.length > 0) {
            renderedSections.push({
              startLine: sec.startLine,
              endLine: sec.endLine,
              lines,
            })
          }
        }

        if (!renderedSections.length) {
          bodyEl.innerHTML =
            `<div class="text-xs text-ink-faint rounded-none">` +
            `<span>${t('指定行区间无内容（文件共 {0} 行）', content.split(/\r?\n/).length)}</span>` +
            `</div>`
          return
        }

        let linesHtml = ''
        const rawLinesText: string[] = []

        for (let sIdx = 0; sIdx < renderedSections.length; sIdx++) {
          const sec = renderedSections[sIdx]

          // 相邻两段行号不连续时展示紧凑极简跳行指示
          if (sIdx > 0) {
            const prevSec = renderedSections[sIdx - 1]
            if (sec.startLine > prevSec.endLine + 1) {
              linesHtml +=
                `<div class="moji-quote-gap flex items-center gap-2 my-1 text-[10px] text-ink-faint/40 select-none">` +
                `<span class="min-w-[2.25rem] text-right pr-2 mr-2.5">···</span>` +
                `<span class="h-px bg-line/30 flex-1"></span>` +
                `</div>`
            }
          }

          for (const line of sec.lines) {
            rawLinesText.push(line.raw)
            linesHtml +=
              `<div class="moji-quote-line flex items-start hover:bg-surface/50 transition-colors rounded-none">` +
              `<button type="button" class="moji-quote-line-no select-none text-right font-sans tabular-nums text-[11px] text-ink-faint/60 hover:text-seal hover:bg-seal/10 min-w-[2.25rem] pr-2 mr-2.5 border-r border-line/40 shrink-0 rounded-none pt-0.5 cursor-pointer transition-colors" title="${t('跳转到第 {0} 行', line.lineNum)}" data-line="${line.lineNum}">` +
              `${line.lineNum}` +
              `</button>` +
              `<span class="moji-quote-line-code font-sans text-xs text-ink whitespace-pre-wrap break-words break-all min-w-0 flex-1 rounded-none leading-5">${line.html}</span>` +
              `</div>`
          }
        }

        bodyEl.innerHTML = `<div class="moji-quote-code select-text rounded-none leading-5">${linesHtml}</div>`

        // 绑定行号点击直接跳转源文件对应行号
        const lineButtons = bodyEl.querySelectorAll<HTMLButtonElement>('.moji-quote-line-no')
        for (const btn of lineButtons) {
          btn.onclick = (e) => {
            e.stopPropagation()
            const lineNo = parseInt(btn.dataset.line ?? '1', 10)
            if (host.onOpenFile) {
              host.onOpenFile(filePath, lineNo, lineNo)
            }
          }
        }

        // 挂载 comment 注解 hover 提示气泡
        attachCommentTooltips(bodyEl)

        if (copyBtn) {
          copyBtn.onclick = () => {
            const textToCopy = rawLinesText.join('\n')
            void navigator.clipboard.writeText(textToCopy).then(() => {
              const prev = copyBtn.textContent
              copyBtn.textContent = t('已复制')
              setTimeout(() => {
                copyBtn.textContent = prev
              }, 1500)
            })
          }
        }
      })
    }
  }

  run()

  return () => {
    removeActiveQuoteTip()
    if (unsub) {
      unsub()
      unsub = null
    }
  }
}

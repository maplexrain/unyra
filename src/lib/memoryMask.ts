import { chunkIntoPieces, memoryHash, memoryRandom, pickSpaced } from './memoryMode'

/**
 * 记忆模式的**纯 DOM 标记管线**（从 note/useMemoryMode 抽出）：给定一个正文根节点与
 * { percent, seed }，把文本块用 Intl.Segmenter 切成 2~4 词的词组片、按「等距铺开 +
 * 种子抖动」平均随机盖住其中若干片——遮罩本体是 CSS（.moji-mem-word：纸色底 +
 * 文字透明，:hover 揭示原文）。独立成模块是为了**单元测试可以直接驱动**：
 * 「反复调整不增殖、拉满全覆盖」这类不变量必须有测试钉着（增殖血案 ×2）。
 *
 * 四条纪律（每一条都对应一次真实翻车）：
 * 1. 一个文本节点只做一次 DOM 操作：Fragment 拼好「裸文本 + 遮罩 span」再整体
 *    replaceWith——逐片 surroundContents 在大文档上是上万次 DOM 手术；
 * 2. TreeWalker **先收进数组再处理**——懒遍历边 replaceWith 边 nextNode，替换落树的
 *    照片会被再走一遍并再次切片，文本成倍增殖；
 * 3. 覆盖取样（pickSpaced）整数格不重叠——浮点步长的相邻格会撞出同一下标，
 *    同一片被包两次，文本原地重复；percent ≥ 100 时直通全覆盖，不经过取样；
 * 4. 逐块异常隔离（safe）：任何一块出异常都不许打断整轮标记、把覆盖冻在部分状态。
 */

/** 词级切片的文本块：段落 / 标题 / 列表项 / 引用 / 表格单元 */
export const MEMORY_WORD_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, figcaption, dd, dt'
/** 切词时跳进去的元素：遮罩不落在链接 / 代码 / chip / 公式 / 注音里（交互件与记号保持可见） */
export const MEMORY_SKIP_INSIDE = 'a, code, .katex, [data-token], sup, script, style'
/** 整块盖的：代码块（按词切代码没有意义），按覆盖范围的概率整块遮 */
export const MEMORY_BLOCK_MASK_SELECTOR = 'pre'

/** 把上一次的词级遮罩拆掉：span 还原成裸文本 + normalize，DOM 回到原始形状 */
export function unwrapMemoryMasks(body: HTMLElement): void {
  for (const span of Array.from(body.querySelectorAll('.moji-mem-word'))) {
    const parent = span.parentNode
    if (!parent) continue
    while (span.firstChild) parent.insertBefore(span.firstChild, span)
    span.remove()
    parent.normalize()
  }
}

export interface MemoryMaskOptions {
  /** 覆盖范围（%）：0 = 不遮任何片，100 = 全部片都盖（直通，不经过取样） */
  percent: number
  /** 随机种子：决定切分与盖住哪几片；同一种子永远同一结果 */
  seed: number
}

export function applyMemoryMasks(body: HTMLElement, opts: MemoryMaskOptions): void {
  // 自含拆旧：无论调用方有没有先拆，进入标记前正文都在原始形状——重复 apply 不可能套娃
  unwrapMemoryMasks(body)
  const { percent, seed } = opts
  let blockIdx = 0
  for (const block of Array.from(body.querySelectorAll<HTMLElement>(MEMORY_WORD_BLOCK_SELECTOR))) {
    // 嵌套块只处理最外层（blockquote > p：外层引用已经把内层段落一起切了）
    if (block.closest('[data-memory-cover]')) continue
    if (block.parentElement?.closest(MEMORY_WORD_BLOCK_SELECTOR)) continue
    try {
      // 文本节点收集：跳过遮罩不该落的元素与空白节点；**先收进数组再处理**（纪律 2）
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode(node: Node): number {
          const parent = node.parentElement
          if (!parent || parent.closest(MEMORY_SKIP_INSIDE)) return NodeFilter.FILTER_REJECT
          return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        },
      })
      const textNodes: Text[] = []
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        textNodes.push(n as Text)
      }
      const rand = memoryRandom(memoryHash(seed, blockIdx))
      for (const textNode of textNodes) {
        const text = textNode.nodeValue ?? ''
        const pieces = chunkIntoPieces(text, rand)
        // 拉满直通：100% 时全部片都盖，不经过取样——覆盖完整性由构造保证（纪律 3）
        const covered =
          percent >= 100
            ? pieces.map((_, i) => i)
            : pickSpaced(pieces.length, Math.round((pieces.length * percent) / 100), rand)
        // 性能纪律 1：按升序把「裸文本 + 遮罩 span」拼进 Fragment，一个文本节点只做一次 replaceWith
        const frag = document.createDocumentFragment()
        let cursor = 0
        for (const idx of covered) {
          const piece = pieces[idx]
          if (piece.start > cursor) {
            frag.appendChild(document.createTextNode(text.slice(cursor, piece.start)))
          }
          const span = document.createElement('span')
          span.className = 'moji-mem-word'
          span.textContent = text.slice(piece.start, piece.end)
          frag.appendChild(span)
          cursor = piece.end
        }
        if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)))
        textNode.replaceWith(frag)
      }
    } catch (err) {
      // 逐块异常隔离（纪律 4）：一块的失败不该把整轮标记打断在半途
      console.warn('[memory-mode] 遮罩标记跳过一块：', err)
    }
    blockIdx++
  }

  // 整块盖：代码块按覆盖范围的概率整块遮（按词切代码没有意义）
  for (const pre of Array.from(body.querySelectorAll<HTMLElement>(MEMORY_BLOCK_MASK_SELECTOR))) {
    if (pre.closest('[data-memory-cover]')) continue
    if (memoryRandom(memoryHash(seed, 0x7000 + blockIdx++))() < percent / 100) {
      pre.setAttribute('data-memory-cover', '')
    }
  }
}

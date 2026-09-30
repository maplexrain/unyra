import type React from 'react'
import { mapRangeToSource } from './sourceMap'

/**
 * 复制文档内容时，把选区换回 **Markdown 源文**。
 *
 * 预览是渲染结果，直接让浏览器复制会带上渲染的痕迹：
 * - 公式在 DOM 里是**两份**（.katex-mathml 与 .katex-html），复制出来是一串对不上的字符；
 * - 代码块、列表、加粗、标题都按视觉排版走，粘到别处只剩一堆断行与符号；
 * - 注解的词条还带着标记。
 * 而这个应用里真正要流转的文本是 Markdown——用户把一段贴回笔记、贴给导师、
 * 贴进别处的文档，想要的都是源文。
 *
 * 做法：把选区映射回源文区间（见 lib/sourceMap 的 mapRangeToSource），命中就
 * 整段切片写进剪贴板，并 preventDefault 掉浏览器那一次；映射不出来
 * （选区整段落在公式/代码块里、或正文刚被改写）时返回 false，
 * 让默认复制照常发生——宁可给渲染文字，不能什么都不给。
 *
 * **只写 text/plain**：多写一份 text/html 的话，富文本目标（Word、飞书、笔记类应用）
 * 会优先挑那一份，用户要的「原 markdown」就永远轮不上。
 *
 * 返回 true 表示「这一下已经由我们处理」，调用方不必再做别的。
 */
export function copySelectionAsMarkdown(
  e: React.ClipboardEvent,
  root: HTMLElement | null,
  source: string,
): boolean {
  if (!root || !source) return false
  const sel = typeof window === 'undefined' ? null : window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  // 选区不在这一份正文里（比如从正文拖到了页脚）就交给默认复制
  if (!root.contains(range.commonAncestorContainer)) return false
  const loc = mapRangeToSource(root, range, source)
  if (!loc) return false
  // 两头把空白削掉：拖选一条句子总会多带一个换行或缩进，
  // 粘出来多一行空行是最容易被骂的那种「格式问题」
  const md = source.slice(loc.start, loc.end).replace(/^\s+|\s+$/g, '')
  if (!md) return false
  e.preventDefault()
  e.clipboardData.setData('text/plain', md)
  return true
}

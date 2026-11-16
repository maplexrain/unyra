import { useEffect, useRef } from 'react'
import { isVimEnabled } from '../../../lib/vimSettings'
import { openGlobalCommandBar } from '../../../lib/commandBarFocus'
import { docScrollElement, scrollToDoc, visibleDocBody } from '../../../lib/docDom'
import { triggerShortcutAction } from '../../../lib/shortcuts'
import { focusedGroup } from '../../../learn/groups'
import { viewOf } from '../../../learn/tabs'
import type { LearnStore } from '../../../learn/types'
import { BrowseSmoothCursor } from './browseSmoothCursor'

export interface UseBrowseVimParams {
  getLatest: () => LearnStore
  onToast?: (msg: string) => void
  nextTab?: () => void
  prevTab?: () => void
}

/** 判定事件目标是否为可输入编辑元素或浮层对话框 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.closest('.cm-editor, .cm-content, [role="textbox"]')) return true
  if (target.closest('.modal-scrim, [role="dialog"], [role="menu"]')) return true
  if (target.closest('[data-command-bar]')) return true
  return false
}

/** 寻找正文根节点下首个可见的有效文本节点 */
function findVisibleTextNode(root: HTMLElement, scrollBox?: HTMLElement | null): Text | null {
  const topThreshold = scrollBox ? scrollBox.getBoundingClientRect().top : 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest('button, input, textarea, select, [data-ignore-caret]')) {
        return NodeFilter.FILTER_REJECT
      }
      const s = window.getComputedStyle(parent)
      if (s.display === 'none' || s.visibility === 'hidden') {
        return NodeFilter.FILTER_REJECT
      }
      if (!node.textContent || node.textContent.trim().length === 0) {
        return NodeFilter.FILTER_SKIP
      }
      const rect = parent.getBoundingClientRect()
      if (scrollBox && rect.bottom < topThreshold) {
        return NodeFilter.FILTER_SKIP
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const first = walker.nextNode() as Text | null
  if (first) return first

  // 回退：不考虑视口阈值，取文档内第一个文本节点
  const fallbackWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent || node.textContent.trim().length === 0) return NodeFilter.FILTER_SKIP
      return NodeFilter.FILTER_ACCEPT
    },
  })
  return fallbackWalker.nextNode() as Text | null
}

/** 确保当前 Selection 位于当前活动正文节点内 */
function ensureSelectionInDoc(body: HTMLElement, scrollBox?: HTMLElement | null): Selection | null {
  const sel = window.getSelection()
  if (!sel) return null
  if (sel.rangeCount > 0 && sel.anchorNode && body.contains(sel.anchorNode)) {
    return sel
  }
  const textNode = findVisibleTextNode(body, scrollBox)
  if (textNode) {
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  return sel
}

/** 将选区所在元素滚动到当前可视区域 */
function scrollSelectionIntoView(sel: Selection): void {
  const target = sel.focusNode instanceof HTMLElement ? sel.focusNode : sel.focusNode?.parentElement
  if (target && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

/** 执行光标移动（普通模式 move，可视模式 extend）并驱动平滑光标与拖尾 */
function moveCaret(
  sel: Selection,
  direction: 'forward' | 'backward',
  granularity: 'character' | 'word' | 'line' | 'lineboundary' | 'documentboundary',
  isVisual: boolean,
  smoothCursor: BrowseSmoothCursor,
): void {
  const alter = isVisual ? 'extend' : 'move'
  try {
    if (typeof (sel as any).modify === 'function') {
      (sel as any).modify(alter, direction, granularity)
    }
  } catch {
    // 忽略浏览器不支持或不可移动异常
  }
  scrollSelectionIntoView(sel)
  smoothCursor.update(sel, isVisual)
}

/**
 * 允许页面处于浏览模式（只读阅读态）下使用 Vim 进行光标漫游、选区扩选与复制等只读操作。
 */
export function useBrowseVim({ getLatest, onToast, nextTab, prevTab }: UseBrowseVimParams): void {
  const pendingPrefix = useRef<{ key: string; time: number } | null>(null)
  const isVisualModeRef = useRef<boolean>(false)
  const isComposingRef = useRef<boolean>(false)
  const lastToastTime = useRef<number>(0)
  const smoothCursorRef = useRef<BrowseSmoothCursor | null>(null)

  useEffect(() => {
    if (!smoothCursorRef.current) {
      smoothCursorRef.current = new BrowseSmoothCursor()
    }
    const smoothCursor = smoothCursorRef.current

    // 监听输入法合成状态：在合成期间绝不拦截按键
    const onCompStart = () => {
      isComposingRef.current = true
    }
    const onCompEnd = () => {
      isComposingRef.current = false
    }

    const onScroll = () => {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        smoothCursor.update(sel, isVisualModeRef.current)
      }
    }

    const onSelectionChange = () => {
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      const activeTab = group?.tabs.find((t) => t.id === group.active)
      if (activeTab && viewOf(activeTab, false) === 'source') {
        smoothCursor.destroy()
        return
      }
      const sel = window.getSelection()
      const body = visibleDocBody()
      if (sel && body && sel.anchorNode && body.contains(sel.anchorNode)) {
        smoothCursor.update(sel, isVisualModeRef.current)
      } else {
        smoothCursor.update(null, false)
      }
    }

    window.addEventListener('compositionstart', onCompStart, true)
    window.addEventListener('compositionend', onCompEnd, true)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    document.addEventListener('selectionchange', onSelectionChange)

    const onKeyDown = (e: KeyboardEvent) => {
      // 1. 系统输入法组词保护：在输入法组词或未确认有效字符输入期间，绝不拦截键盘输入
      if (
        isComposingRef.current ||
        e.isComposing ||
        e.keyCode === 229 ||
        e.key === 'Process' ||
        e.key === 'Unidentified' ||
        e.key === 'Dead'
      ) {
        return
      }

      // 未开启 Vim 或处于文本输入区域时忽略
      if (!isVimEnabled() || isEditableTarget(e.target)) return

      // 若当前活动页签正处于源码编辑模式，交由 CodeMirror Vim 自身接管
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      const activeTab = group?.tabs.find((t) => t.id === group.active)
      if (activeTab && viewOf(activeTab, false) === 'source') {
        smoothCursor.destroy()
        return
      }

      const key = e.key
      const isCtrl = e.ctrlKey || e.metaKey
      const isAlt = e.altKey

      if (isAlt) return

      const now = Date.now()
      const prefix = pendingPrefix.current
      if (prefix && now - prefix.time > 800) {
        pendingPrefix.current = null
      }

      // 2. 退出可视模式或清除前缀 (Escape)
      if (key === 'Escape') {
        if (isVisualModeRef.current) {
          e.preventDefault()
          e.stopPropagation()
          isVisualModeRef.current = false
          window.getSelection()?.collapseToEnd()
          smoothCursor.update(window.getSelection(), false)
          onToast?.('-- 普通模式 (NORMAL) --')
          return
        }
        if (pendingPrefix.current) {
          e.preventDefault()
          e.stopPropagation()
          pendingPrefix.current = null
          return
        }
      }

      // 3. 冒号唤起全局命令栏（支持 :edit, :q, :tabo, :open 等）
      if (!isCtrl && (key === ':' || (e.shiftKey && key === ';'))) {
        e.preventDefault()
        e.stopPropagation()
        pendingPrefix.current = null
        openGlobalCommandBar({ prefill: ':' })
        return
      }

      // 4. 多键组合序列判断 (如 gg, gt, gT, zz, zt, zb, yy)
      if (pendingPrefix.current) {
        const pKey = pendingPrefix.current.key
        pendingPrefix.current = null

        if (pKey === 'g') {
          if (key === 'g') {
            e.preventDefault()
            e.stopPropagation()
            const body = visibleDocBody()
            const box = docScrollElement()
            if (body) {
              const sel = ensureSelectionInDoc(body, box)
              if (sel) moveCaret(sel, 'backward', 'documentboundary', isVisualModeRef.current, smoothCursor)
            }
            scrollToDoc({ to: 'top' })
            return
          }
          if (key === 't') {
            e.preventDefault()
            e.stopPropagation()
            nextTab?.()
            return
          }
          if (key === 'T') {
            e.preventDefault()
            e.stopPropagation()
            prevTab?.()
            return
          }
        }

        if (pKey === 'z') {
          if (key === 't') {
            e.preventDefault()
            e.stopPropagation()
            scrollToDoc({ to: 'top' })
            return
          }
          if (key === 'b') {
            e.preventDefault()
            e.stopPropagation()
            scrollToDoc({ to: 'bottom' })
            return
          }
          if (key === 'z') {
            e.preventDefault()
            e.stopPropagation()
            const box = docScrollElement()
            if (box) {
              box.scrollBy({ top: box.clientHeight / 4, behavior: 'smooth' })
            }
            return
          }
        }

        if (pKey === 'y' && key === 'y') {
          // yy 复制当前行并写入系统剪贴板
          e.preventDefault()
          e.stopPropagation()
          const body = visibleDocBody()
          const box = docScrollElement()
          if (!body) return
          const sel = ensureSelectionInDoc(body, box)
          if (!sel) return
          const origRange = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null
          let lineText = ''
          try {
            if (typeof (sel as any).modify === 'function') {
              (sel as any).modify('move', 'backward', 'lineboundary');
              (sel as any).modify('extend', 'forward', 'lineboundary');
              lineText = sel.toString()
            }
          } catch {
            // 忽略异常
          }
          if (!lineText) {
            const parentBlock = sel.focusNode?.parentElement?.closest('p, h1, h2, h3, h4, h5, h6, li, tr, div, pre')
            lineText = parentBlock?.textContent?.trim() || ''
          }
          if (lineText) {
            void navigator.clipboard.writeText(lineText + '\n').then(() => {
              onToast?.('[已复制当前行到系统剪贴板]')
            }).catch(() => {
              onToast?.('[已复制当前行]')
            })
          }
          if (origRange) {
            sel.removeAllRanges()
            sel.addRange(origRange)
          }
          smoothCursor.update(sel, false)
          return
        }
      }

      // 5. 单键序列前缀触发 (g, z, y)
      if (!isCtrl && (key === 'g' || key === 'z' || (key === 'y' && window.getSelection()?.isCollapsed))) {
        pendingPrefix.current = { key, time: now }
        return
      }

      // 6. 模式切换：v 字符可视模式，V 行可视模式
      if (!isCtrl && key === 'v') {
        e.preventDefault()
        e.stopPropagation()
        const body = visibleDocBody()
        const box = docScrollElement()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          isVisualModeRef.current = !isVisualModeRef.current
          if (isVisualModeRef.current) {
            onToast?.('-- 可视模式 (VISUAL) --')
          } else {
            sel?.collapseToEnd()
            onToast?.('-- 普通模式 (NORMAL) --')
          }
          smoothCursor.update(sel, isVisualModeRef.current)
        }
        return
      }

      if (!isCtrl && key === 'V') {
        e.preventDefault()
        e.stopPropagation()
        const body = visibleDocBody()
        const box = docScrollElement()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          if (sel) {
            isVisualModeRef.current = true
            try {
              if (typeof (sel as any).modify === 'function') {
                (sel as any).modify('move', 'backward', 'lineboundary');
                (sel as any).modify('extend', 'forward', 'lineboundary');
              }
            } catch {
              // 忽略
            }
            onToast?.('-- 可视行模式 (VISUAL LINE) --')
            smoothCursor.update(sel, true)
          }
        }
        return
      }

      // 7. 文本复制 (y)：可视模式或存在选中内容时直接写入系统剪贴板
      if (!isCtrl && key === 'y') {
        const sel = window.getSelection()
        const selText = sel?.toString()
        if (selText) {
          e.preventDefault()
          e.stopPropagation()
          void navigator.clipboard.writeText(selText).then(() => {
            onToast?.('[已复制到系统剪贴板]')
          }).catch(() => {
            onToast?.('[已复制]')
          })
          sel?.collapseToEnd()
          isVisualModeRef.current = false
          smoothCursor.update(sel, false)
          return
        }
      }

      // 8. Caret 光标移动 (h/j/k/l, w/b, 0/$, 方向键)
      const body = visibleDocBody()
      const box = docScrollElement()
      const isVisual = isVisualModeRef.current

      if (!isCtrl && (key === 'h' || key === 'ArrowLeft')) {
        e.preventDefault()
        e.stopPropagation()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          if (sel) moveCaret(sel, 'backward', 'character', isVisual, smoothCursor)
        }
        return
      }

      if (!isCtrl && (key === 'l' || key === 'ArrowRight')) {
        e.preventDefault()
        e.stopPropagation()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          if (sel) moveCaret(sel, 'forward', 'character', isVisual, smoothCursor)
        }
        return
      }

      if (!isCtrl && (key === 'j' || key === 'ArrowDown')) {
        e.preventDefault()
        e.stopPropagation()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          if (sel) moveCaret(sel, 'forward', 'line', isVisual, smoothCursor)
        } else {
          scrollToDoc({ by: 80 })
        }
        return
      }

      if (!isCtrl && (key === 'k' || key === 'ArrowUp')) {
        e.preventDefault()
        e.stopPropagation()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          if (sel) moveCaret(sel, 'backward', 'line', isVisual, smoothCursor)
        } else {
          scrollToDoc({ by: -80 })
        }
        return
      }

      if (!isCtrl && key === 'w') {
        e.preventDefault()
        e.stopPropagation()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          if (sel) moveCaret(sel, 'forward', 'word', isVisual, smoothCursor)
        }
        return
      }

      if (!isCtrl && key === 'b') {
        e.preventDefault()
        e.stopPropagation()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          if (sel) moveCaret(sel, 'backward', 'word', isVisual, smoothCursor)
        }
        return
      }

      if (!isCtrl && key === '0') {
        e.preventDefault()
        e.stopPropagation()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          if (sel) moveCaret(sel, 'backward', 'lineboundary', isVisual, smoothCursor)
        }
        return
      }

      if (!isCtrl && key === '$') {
        e.preventDefault()
        e.stopPropagation()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          if (sel) moveCaret(sel, 'forward', 'lineboundary', isVisual, smoothCursor)
        }
        return
      }

      if (!isCtrl && key === 'G') {
        e.preventDefault()
        e.stopPropagation()
        if (body) {
          const sel = ensureSelectionInDoc(body, box)
          if (sel) moveCaret(sel, 'forward', 'documentboundary', isVisual, smoothCursor)
        }
        scrollToDoc({ to: 'bottom' })
        return
      }

      // 9. 翻页与大跨度跳动 (Ctrl+d, Ctrl+u, d, u, Ctrl+f, Ctrl+b)
      if ((isCtrl && key === 'd') || (!isCtrl && key === 'd')) {
        e.preventDefault()
        e.stopPropagation()
        if (box) box.scrollBy({ top: box.clientHeight * 0.5, behavior: 'smooth' })
        else scrollToDoc({ by: 300 })
        return
      }

      if ((isCtrl && key === 'u') || (!isCtrl && key === 'u')) {
        e.preventDefault()
        e.stopPropagation()
        if (box) box.scrollBy({ top: -box.clientHeight * 0.5, behavior: 'smooth' })
        else scrollToDoc({ by: -300 })
        return
      }

      if (isCtrl && key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        if (box) box.scrollBy({ top: box.clientHeight * 0.85, behavior: 'smooth' })
        else scrollToDoc({ by: 500 })
        return
      }

      if (isCtrl && key === 'b') {
        e.preventDefault()
        e.stopPropagation()
        if (box) box.scrollBy({ top: -box.clientHeight * 0.85, behavior: 'smooth' })
        else scrollToDoc({ by: -500 })
        return
      }

      if (isCtrl && key === 'e') {
        e.preventDefault()
        e.stopPropagation()
        scrollToDoc({ by: 40 })
        return
      }

      if (isCtrl && key === 'y') {
        e.preventDefault()
        e.stopPropagation()
        scrollToDoc({ by: -40 })
        return
      }

      // 10. 搜索 (/)
      if (!isCtrl && key === '/') {
        e.preventDefault()
        e.stopPropagation()
        triggerShortcutAction('doc.find')
        return
      }

      // 11. 只读模式防呆与编辑提示（i, a, o, c, s, r, x, p）
      const editKeys = ['i', 'a', 'o', 'c', 's', 'r', 'x', 'p']
      if (!isCtrl && editKeys.includes(key)) {
        e.preventDefault()
        e.stopPropagation()
        if (now - lastToastTime.current > 1500) {
          lastToastTime.current = now
          onToast?.('当前处于浏览模式（只读），可输入 :edit 切换至编辑模式')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('compositionstart', onCompStart, true)
      window.removeEventListener('compositionend', onCompEnd, true)
      window.removeEventListener('scroll', onScroll, { capture: true })
      document.removeEventListener('selectionchange', onSelectionChange)
      smoothCursor.destroy()
    }
  }, [getLatest, onToast, nextTab, prevTab])
}

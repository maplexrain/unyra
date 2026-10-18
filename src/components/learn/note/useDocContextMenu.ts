/**
 * 这个文件负责什么：文档区**右键菜单**的接线——什么时候弹（右键落在正文里的选区上）、
 * 什么时候收、摆在哪儿，以及三项动作怎么落地（复制 / 粘贴 / 定位源码）。
 *
 * 与划词菜单（note/useSelectionMenu）是两件事，别合并：
 * - 划词菜单是「对着这段文字**做点什么**」（学习 / 了解 / 注解 / 询问），松开鼠标就弹；
 * - 右键菜单是「对这段文字**在文档里的位置**做点什么」（复制成 Markdown / 就地粘贴 /
 *   跳到源码里同一处），只在用户主动右键时出现。
 * 两个菜单共用一次「渲染选区 → 源文区间」的映射（lib/sourceMap），那才是它们真正的交集。
 *
 * 菜单长什么样在 note/docContextMenu，这里只管进出、定位与三个动作的落地；
 * 「改正文」与「切源码视图」都交回上层（onInsert / onRevealSource）——这一层不认识 store。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { usePresence } from '../../../lib/presence'
import { mapRangeToSource } from '../../../lib/sourceMap'
import { t } from '../../../i18n'

/** 源文里的一段（与 lib/sourceMap 的返回同形） */
export interface SourceSpan {
  start: number
  end: number
}

export interface DocMenuState {
  /** 指针位置（视口坐标）：菜单贴着右键的地方出现，越界由 useClampToViewport 夹回来 */
  x: number
  y: number
  /** 选区映射回源文的区间；映射不出来时为 null（复制退回渲染文字，另两项禁用） */
  loc: SourceSpan | null
  /** 选中的渲染文字（映射失败时复制用它，也是菜单标题里的那句预览） */
  text: string
}

interface Opts {
  /** 正文根节点：右键要落在它里面才算数 */
  bodyRef: RefObject<HTMLDivElement | null>
  /** 当前正文的源文（映射要用它，粘贴也按它切片） */
  content: string
  /** 粘贴：把剪贴板里的文字插到源文 loc 处（上层自己拼新正文、进暂存区） */
  onInsert?: (text: string, loc: SourceSpan) => void
  /** 定位源码：切到源码视图并选中这段源文（上层负责切视图，见 lib/docReveal） */
  onRevealSource?: (loc: SourceSpan) => void
  /** 出问题说一句（读不到剪贴板、定位不了） */
  onError?: (message: string) => void
  /** 复制成功说一句 */
  onCopied?: () => void
}

export function useDocContextMenu({ bodyRef, content, onInsert, onRevealSource, onError, onCopied }: Opts) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<DocMenuState | null>(null)
  /**
   * 开合交给 usePresence：收起时留着数据，退场动画那一帧还要照着 menu 渲染
   * （直接 setMenu(null) 会让组件读到 null 崩掉）。
   */
  const { setOpen, mounted, closing } = usePresence()
  const close = useCallback(() => setOpen(false), [setOpen])

  /*
   * 右键：只在「正文里有一段选中的文字」时接管。
   *
   * 没有选区就**不 preventDefault**：正文里的链接、图片、代码块各有各的原生行为，
   * 在一个空白的右键上塞一条只有三项的菜单，等于把浏览器/Electron 该做的事挤掉。
   *
   * 监听挂在 document 上、再按 bodyRef 认地方，而不是直接挂在正文节点上：正文节点会
   * 随视图切换重建（本地文件切到源码再切回来就是一棵新 DOM），挂在节点上的话，
   * 重建之后那条监听就没了，而 effect 的依赖（正文）一个都没变，谁也不会重新挂一次。
   */
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const body = bodyRef.current
      if (!body || !(e.target instanceof Node) || !body.contains(e.target)) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      if (!body.contains(range.commonAncestorContainer)) return
      const text = sel.toString().replace(/\s+/g, ' ').trim()
      if (!text) return
      e.preventDefault()
      // 立刻在渲染 DOM 上映射回源文：菜单一开，选区随时可能被别处的点击弄丢
      setMenu({ x: e.clientX, y: e.clientY, loc: mapRangeToSource(body, range, content), text })
      setOpen(true)
    }
    document.addEventListener('contextmenu', onCtx)
    return () => document.removeEventListener('contextmenu', onCtx)
  }, [bodyRef, content, setOpen])

  /**
   * 复制：进剪贴板的是**源文**那一截，不是渲染结果——公式在 DOM 里是两份、
   * 注解还带着标记，直接复制渲染文字会得到一串对不上的字符（与 Ctrl+C 同一条口径，
   * 见 lib/copySource）。映射不出来时退回选区文字：宁可给渲染文字，不能什么都不给。
   */
  const runCopy = useCallback(() => {
    const m = menu
    if (!m) return
    close()
    const md = m.loc ? content.slice(m.loc.start, m.loc.end).trim() : m.text
    if (!md) return
    void navigator.clipboard
      .writeText(md)
      .then(() => onCopied?.())
      .catch(() => onError?.(t('复制失败：剪贴板不可用')))
  }, [menu, content, close, onCopied, onError])

  /**
   * 粘贴：读剪贴板，交给上层替换掉选中的那段源文。
   *
   * 为什么落点是**源文区间**而不是光标：预览里没有光标，用户选中的就是他要替换的那一段；
   * 换成整段追加，粘一次就得自己去源码里收拾一次。
   */
  const runPaste = useCallback(() => {
    const m = menu
    if (!m) return
    close()
    if (!m.loc) {
      onError?.(t('没能在源文里定位到这一段，先选中一段正文再粘贴'))
      return
    }
    const loc = m.loc
    void navigator.clipboard
      .readText()
      .catch(() => '')
      .then((text) => {
        if (!text) {
          onError?.(t('读不到剪贴板里的文字'))
          return
        }
        onInsert?.(text, loc)
      })
  }, [menu, close, onInsert, onError])

  /** 定位源码：切到源码视图，并选中这段文字在源文里的位置（见 lib/docReveal） */
  const runReveal = useCallback(() => {
    const m = menu
    if (!m) return
    close()
    if (!m.loc) {
      onError?.(t('没能在源码里定位到这一段'))
      return
    }
    onRevealSource?.(m.loc)
  }, [menu, close, onRevealSource, onError])

  return { menu, menuRef, mounted, closing, close, runCopy, runPaste, runReveal }
}

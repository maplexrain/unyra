import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useDocScroll } from '../../lib/docScroll'
import { t } from '../../i18n'
import { resolveLanguageId } from '../../syntax/LanguageAliases'
import { highlight } from '../../syntax/SyntaxHighlighter'
import { AUTO_THEME, renderHighlight } from '../../syntax/Theme'

/**
 * 源码视图：直接编辑文档源文。
 *
 * 输入区是 **div + contenteditable="plaintext-only"**（不是 textarea，也不是引来的
 * CodeMirror/Monaco）：plaintext-only 是 Chromium 原生的「纯文本可编辑」——输入、
 * 删除、粘贴都自动是纯文本，富文本粘贴 / 拖花样进不来，正好是「编辑器不是 IDE」
 * 这条需求的实现方式。语法高亮按**文件扩展名**选语言（复用正文代码块那套
 * TextMate 管线），只上颜色，没有补全、没有诊断——毕竟这不是正式的 IDE。
 *
 * 高亮与光标的关系：输入时先把纯文本交给上层（onChange 进暂存区），停手一小段
 * 再重新 tokenize；替换 innerHTML 之前记下光标的文本偏移、替换后还原——改到一半
 * 光标不该跳回行首。太大的文件 tokenize 会超闸（见 SyntaxHighlighter 的上限），
 * 那就保持纯文本，正文照样可见可编辑。
 *
 * 组件本身**不存内容**：value 由上层给、onChange 交回上层（上层把它记进暂存区，
 * 见 learn/drafts）。Ctrl+S 不在这里处理：它是一条登记在快捷键注册表里的动作
 * （见 lib/shortcuts 的 learn.save），写死在这儿的话，用户在设置里改的那个键
 * 就成了一句空话。
 */

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

const STATE_TEXT: Record<SaveState, string> = {
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中…',
  error: '保存失败',
}

const STATE_TONE: Record<SaveState, string> = {
  saved: 'text-ink-faint',
  dirty: 'text-warn-deep',
  saving: 'text-ink-faint',
  error: 'text-seal-deep',
}

/** 光标（折叠选区）在整段文本里的偏移：跨元素地数，内容怎么包 span 都不影响 */
function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0).cloneRange()
  const pre = document.createRange()
  pre.selectNodeContents(el)
  try {
    pre.setEnd(range.endContainer, range.endOffset)
  } catch {
    return 0
  }
  return pre.toString().length
}

/** 把光标放回文本偏移处（按 text 节点逐个数过去）；越界就落到末尾 */
function setCaretOffset(el: HTMLElement, offset: number): void {
  const sel = window.getSelection()
  if (!sel) return
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (remaining <= node.data.length) {
      const range = document.createRange()
      range.setStart(node, Math.max(0, remaining))
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    remaining -= node.data.length
  }
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

interface Props {
  value: string
  onChange: (next: string) => void
  /** 保存状态（由上层维护：它才知道内容去哪、存成了没有） */
  state: SaveState
  /** 保存失败的原因（state 为 error 时显示） */
  error?: string
  /** 左下角那句说明：这是哪一份文件 */
  label: string
  /** 扩展名（带点，如 '.py'）：按它选语法高亮的语言；认不出就是纯文本 */
  ext?: string
  /** 只读（比如正在等超级导师写这一节） */
  readOnly?: boolean
  placeholder?: string
  /** 正文字号系数，与预览视图共用同一个（见 lib/appearance 的 docScale） */
  scale?: number
  /** 上一次编辑到哪儿（px）：挂载时恢复一次，见 lib/docScroll */
  scrollTop?: number
  /** 滚动到哪儿了的上报（与预览各记各的：编辑位置与阅读位置是两回事） */
  onScrollTop?: (top: number) => void
}

export default function SourceEditor({
  value,
  onChange,
  state,
  error,
  label,
  ext,
  readOnly = false,
  placeholder,
  scale = 1,
  scrollTop,
  onScrollTop,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  /**
   * 「界面上此刻的字」——不是 React 的 value，而是编辑区实际显示的那份。
   * 初始是 **null**：挂载那一趟必须画（contenteditable 的 div 自己没有内容，
   * 不画的话编辑区是空的，直到高亮异步做完才冒出正文）。value 与它一致就是
   * 「刚输入的 / 已经画上去的」，不必动 DOM；不一致才是外部改动（暂存被撤、
   * 外部文件变了），那时才整块重写。
   */
  const shownRef = useRef<string | null>(null)
  /** 重排高亮的定时器；每次输入都会重排一次，防抖别让逐键 tokenize 卡手 */
  const hlTimer = useRef<number | null>(null)
  /** 在途高亮的作废标记：value 已变 / 组件已卸载时，晚到的结果不再写 DOM */
  const hlToken = useRef(0)
  /** 外部改动是否要保光标（编辑中外部覆盖极少见，但一旦发生不该把人甩回行首） */
  const focusedRef = useRef(false)

  /**
   * 取容器的那只回调必须是**稳定**的：useDocScroll 拿它当 effect 依赖，每轮渲染现写的
   * 箭头会让滚动监听被反复拆掉重挂——而拆的时候还要补发一次位置上报，等于白写盘。
   * 编辑区是常驻的（见下面的 JSX，没有任何条件包裹），所以它一直取同一个元素。
   */
  const scrollBox = useCallback(() => ref.current, [])
  // 编辑位置与阅读位置各记各的（键由上层分开）：共用一格的话，切换视图会互相拽
  useDocScroll(scrollBox, scrollTop, onScrollTop, true)

  const languageId = resolveLanguageId(ext?.replace(/^\./, '') ?? null)

  /** 把一段代码画进编辑区（高亮失败 / 太大就画纯文本，正文不能消失）。
      style 是主题的 token 颜色变量（--tok-*），必须落在编辑区上颜色才生效 */
  const paint = useCallback(
    (code: string, html: string | null, style?: Record<string, string>): void => {
      const el = ref.current
      if (!el) return
      if (html === null) {
        if (el.textContent !== code) el.textContent = code
        return
      }
      const keep = focusedRef.current ? caretOffset(el) : -1
      el.innerHTML = html
      if (style) for (const [name, v] of Object.entries(style)) el.style.setProperty(name, v)
      if (keep >= 0) setCaretOffset(el, keep)
    },
    [],
  )

  /** 排一次重高亮：防抖合并连续输入；晚到的结果用 token 作废 */
  const scheduleHighlight = useCallback(
    (code: string) => {
      if (hlTimer.current !== null) window.clearTimeout(hlTimer.current)
      const token = ++hlToken.current
      hlTimer.current = window.setTimeout(() => {
        hlTimer.current = null
        void highlight(code, languageId).then((result) => {
          if (token !== hlToken.current) return
          const el = ref.current
          // 卸载了的编辑区（isConnected=false）不再写：晚到的 innerHTML 写进废弃节点是白写
          if (!el || !el.isConnected || el.textContent !== code) return
          if (result.plain) {
            paint(code, null)
            return
          }
          const rendered = renderHighlight(result, AUTO_THEME)
          paint(code, rendered.html || null, rendered.style)
        })
      }, 260)
    },
    [languageId, paint],
  )

  // value 变了（外部改动 / 首次挂载 / 切视图回来）：整块重画。立即画纯文本保证可见，
  // 高亮随后异步补上
  useLayoutEffect(() => {
    if (value === shownRef.current) return
    shownRef.current = value
    paint(value, null)
    scheduleHighlight(value)
  }, [value, paint, scheduleHighlight])

  // 挂载与语言变化时补一次高亮（value 的高亮由输入路径与上面的 effect 负责——
  // value 刻意不进依赖：外部改动那一趟已经在 useLayoutEffect 里排过了）
  useEffect(() => {
    scheduleHighlight(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleHighlight])

  /**
   * 挂载时把焦点给正文：从预览切到源码，用户按下去的那些键理应立即进正文。
   * 不把光标放到末尾——切过来多半是想接着改，而末尾未必是他刚看到的那一段。
   */
  useEffect(() => {
    ref.current?.focus()
  }, [])

  const chars = value.replace(/\s/g, '').length

  return (
    <div className="print-flat flex min-h-0 flex-1 flex-col bg-card">
      <div className="min-h-0 flex-1 overflow-hidden">
        {/*
         * pt-11（44px）而不是 py-5：文档区右上角浮着那排按钮（悬浮组），
         * 画面窄的时候它正压在首行上——首行从这里往下让开一整条按钮的高度。
         * 左右是 pl-[32px] pr-[22px]，与预览那一列的正文左右对齐——同一份文档在
         * 源码 / 预览之间来回切时，字不会左右跳这 8px。
         * doc-measure 与预览共用同一列宽（见 index.css）。
         * contentEditable 用 'plaintext-only'（React 会当成未知值原样落属性）：
         * Chromium 的原生纯文本编辑，输入 / 粘贴自动不带任何样式。
         */}
        <div
          ref={ref}
          contentEditable={readOnly ? false : 'plaintext-only'}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          spellCheck={false}
          data-placeholder={placeholder}
          onInput={(e) => {
            const next = e.currentTarget.textContent ?? ''
            shownRef.current = next
            onChange(next)
            scheduleHighlight(next)
          }}
          onFocus={() => {
            focusedRef.current = true
          }}
          onBlur={() => {
            focusedRef.current = false
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              // 换行必须由我们插：plaintext-only 下浏览器自作的换行不一定是真正的
              // 「\n」文本（<br> 一类，textContent 拼不出来）——重高亮一替换，
              // 刚敲的那一行就弹没了。insertText 塞一个真换行字符，pre-wrap 下可见可数。
              e.preventDefault()
              document.execCommand('insertText', false, '\n')
              return
            }
            if (e.key !== 'Tab') return
            // Tab 在正文里该是缩进。不挡掉的话焦点会跑出去，改到一半跳走最恼人
            e.preventDefault()
            document.execCommand('insertText', false, '  ')
          }}
          onPaste={(e) => {
            // plaintext-only 本就只收纯文本，但剪贴板里只有图片 / 文件时默认行为
            // 会把它塞进编辑区——这种「粘贴了却看不见」的输入一律挡掉
            if (e.clipboardData.files.length) e.preventDefault()
          }}
          className="moji-source-editor doc-measure block h-full overflow-auto whitespace-pre-wrap break-words bg-transparent pl-[32px] pr-[22px] pt-11 pb-5 text-ink outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-ink-faint"
          style={{ fontSize: Math.round(13 * scale * 10) / 10 + 'px' }}
        />
      </div>

      {/* 底栏：这是哪一份文件、多少字、存了没有。三件事都只在编辑时才需要，所以放最下面 */}
      <div className="no-print flex shrink-0 items-center gap-3 border-t border-line px-4 py-1 text-[11px] text-ink-faint">
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        <span className="shrink-0 tabular-nums">{t('{0} 字', chars)}</span>
        <span
          className={'shrink-0 ' + STATE_TONE[state]}
          title={state === 'error' ? error : t(STATE_TEXT[state])}
        >
          {t(STATE_TEXT[state])}
        </span>
      </div>
    </div>
  )
}

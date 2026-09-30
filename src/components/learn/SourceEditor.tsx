import { useCallback, useEffect, useRef } from 'react'
import { useDocScroll } from '../../lib/docScroll'
import { t } from '../../i18n'

/**
 * 源码视图：直接编辑 Markdown 源文。
 *
 * 为什么用 textarea 而不是引一个代码编辑器：这里要编的是 Markdown 正文（几 KB），
 * 需要的是「能改、改完立刻生效、Ctrl+S 能存」，而不是语法高亮与折叠。
 * 引一个编辑器（CodeMirror/Monaco）要多几百 KB 与一套主题适配，
 * 换来的东西在这个场景里用不上——预览视图就在旁边一个按钮的距离。
 *
 * 组件本身**不存内容**：value 由上层给、onChange 交回上层（上层把它记进暂存区，
 * 见 learn/drafts）。它只负责把「编辑」这件事做得不难用：Tab 缩进、字数与保存状态显示。
 *
 * Ctrl+S 不在这里处理：它是一条登记在快捷键注册表里的动作（见 lib/shortcuts 的
 * learn.save），写死在这儿的话，用户在设置里改的那个键就成了一句空话。
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

interface Props {
  value: string
  onChange: (next: string) => void
  /** 保存状态（由上层维护：它才知道内容去哪、存成了没有） */
  state: SaveState
  /** 保存失败的原因（state 为 error 时显示） */
  error?: string
  /** 左下角那句说明：这是哪一份文件 */
  label: string
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
  readOnly = false,
  placeholder,
  scale = 1,
  scrollTop,
  onScrollTop,
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  /**
   * 取容器的那只回调必须是**稳定**的：useDocScroll 拿它当 effect 依赖，每轮渲染现写的
   * 箭头会让滚动监听被反复拆掉重挂——而拆的时候还要补发一次位置上报，等于白写盘。
   * textarea 是常驻的（见下面的 JSX，没有任何条件包裹），所以它一直取同一个元素。
   */
  const scrollBox = useCallback(() => ref.current, [])
  // 编辑位置与阅读位置各记各的（键由上层分开）：共用一格的话，切换视图会互相拽
  useDocScroll(scrollBox, scrollTop, onScrollTop, true)

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
        <textarea
          ref={ref}
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              // Tab 在正文里该是缩进。不挡掉的话焦点会跑出去，改到一半跳走最恼人
              e.preventDefault()
              const el = e.currentTarget
              const { selectionStart: s, selectionEnd: en } = el
              const next = value.slice(0, s) + '  ' + value.slice(en)
              onChange(next)
              requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = s + 2
              })
              return
            }
          }}
          /*
           * pt-11（44px）而不是 py-5：文档区右上角浮着那排按钮（悬浮组），
           * 画面窄的时候它正压在首行上——首行从这里往下让开一整条按钮的高度。
           * 左右是 pl-[32px] pr-[22px]，与预览那一列的正文左右对齐——同一份文档在
           * 源码 / 预览之间来回切时，字不会左右跳这 8px。
           *
           * doc-measure 与预览共用同一列宽（见 index.css）；block 不能省——textarea
           * 默认是 inline-block，而 mx-auto 对行内级的盒子不起作用。
           */
          className="moji-source-editor doc-measure block h-full resize-none bg-transparent pl-[32px] pr-[22px] pt-11 pb-5 text-ink outline-none"
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

import { useCallback, useEffect, useRef } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, indentOnInput, indentUnit, bracketMatching, LanguageDescription } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages as codeLanguages } from '@codemirror/language-data'
import { countSourceWords } from '../../lib/wordCount'
import { markdownEditorTheme, markdownHighlight } from '../../lib/cmMarkdown'
import { takeSourceReveal, subscribeSourceReveal, type SourceReveal } from '../../lib/docReveal'
import { useDocScroll } from '../../lib/docScroll'
import { DocStatChip } from './DocFloat'
import { t } from '../../i18n'

/**
 * 源码视图：直接编辑文档源文。编辑器是 **CodeMirror 6**——轻量（按模块打包，
 * 用到的语言解析器才进包）、完全本地（没有一行代码走网络）、markdown 与几十门
 * 语言的开箱高亮全都是现成的。上一版手写的 contenteditable 在「换行该是什么
 * 节点」这类浏览器细节上反复反弹，这类问题正是成熟编辑器的立身之本，不再自造。
 *
 * 颜色全部落在 `--color-code-*` 这组 CSS 变量上（与正文代码块同一份配色，
 * 见 styles/code.css）：切主题只是换变量，编辑器里那段文档不必重新解析。
 *
 * 组件本身**不存内容**：value 由上层给、onChange 交回上层（上层把它记进暂存区，
 * 见 learn/drafts）。value 与编辑器不一致才是外部改动（暂存被撤、外部文件变了），
 * 那时才整段替换。Ctrl+S 不在这里处理：它是一条登记在快捷键注册表里的动作
 * （见 lib/shortcuts 的 learn.save）。
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

/**
 * 配色与主题在 lib/cmMarkdown（随笔窗口用的是同一份）：文档源码视图的内边距
 * 按 doc-measure 那一列调（上 20 / 下 20 / 左 10 / 右 22）。
 */
const editorTheme = markdownEditorTheme({ top: 20, bottom: 20, left: 10, right: 22 })

/** 语言按扩展名现配（markdown 内嵌代码块也各自高亮）；其余扩展名交给 language-data 的表 */
const langComp = new Compartment()
const readOnlyComp = new Compartment()

async function languageExtensions(ext?: string): Promise<Extension[]> {
  if (!ext || /\.(md|markdown)$/i.test(ext)) return [markdown({ base: markdownLanguage, codeLanguages })]
  const desc = LanguageDescription.matchFilename(codeLanguages, 'x' + ext)
  if (!desc) return []
  const support = await desc.load().catch(() => null)
  return support ? [support] : []
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
  /**
   * 「定位源码」的取件凭证（见 lib/docReveal）：预览里右键选了「定位源码」时，
   * 上层先放下「选中哪一段」再切到这个视图，编辑器挂载时凭它取走并选中。
   * 手动点「源码」按钮进来时槽里没有请求，取到 null，行为与从前一模一样。
   */
  revealKey?: string
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
  revealKey,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  /** 上层给进来的最新 value：updateListener 里只把「用户真的改了」交出去 */
  const valueRef = useRef(value)
  const changeRef = useRef(onChange)
  useEffect(() => {
    changeRef.current = onChange
  }, [onChange])

  /**
   * 「定位源码」的那一次请求（见 lib/docReveal）：**挂载时取一次，之后一直用这一份**。
   *
   * 为什么在渲染期取、还配一个 done 哨兵：
   * - 要在 useDocScroll 之前知道「这一次是被定位过来的」——那一次**不能**恢复上次的
   *   编辑位置，否则下一帧就把刚滚到眼前的选区拽回老地方；
   * - 而 StrictMode 下 effect 会跑两遍（卸载重建一次编辑器），槽里的请求取走就没了，
   *   第二遍会取到 null、选区当场丢掉。哨兵让两遍拿到同一份。
   */
  const revealRef = useRef<{ taken: boolean; value: SourceReveal | null }>({ taken: false, value: null })
  if (!revealRef.current.taken) {
    revealRef.current.taken = true
    revealRef.current.value = revealKey ? takeSourceReveal(revealKey) : null
  }
  const reveal = revealRef.current.value

  /**
   * 取滚动元素的那只回调必须是**稳定**的：useDocScroll 拿它当 effect 依赖，每轮渲染
   * 现写的箭头会让滚动监听被反复拆掉重挂——而拆的时候还要补发一次位置上报，等于白写盘。
   * view 常驻到卸载（语言变化走 compartment 重配，不重建实例），scrollDOM 一直是同一个。
   */
  const getScrollEl = useCallback((): HTMLElement | null => viewRef.current?.scrollDOM ?? null, [])
  // 编辑位置与阅读位置各记各的（键由上层分开）：共用一格的话，切换视图会互相拽。
  // 「定位源码」过来的那一次不恢复旧位置——落点由下面那个 effect 选中并滚过去
  useDocScroll(getScrollEl, reveal ? undefined : scrollTop, onScrollTop, true)

  // 挂载：创建 view；卸载：销毁
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current ?? undefined,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          history(),
          keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
          // 符号自动补全（输入 ( [ { " ' ` 自动带出另一半、跳过与删除成对）与括号配对高亮
          closeBrackets(),
          bracketMatching(),
          // 自动缩进：换行继承上一行的缩进，语言有语法的话按语法缩进；缩进单位是两个空格
          indentOnInput(),
          indentUnit.of('  '),
          EditorView.lineWrapping,
          readOnlyComp.of([]),
          langComp.of([]),
          cmPlaceholder(placeholder ?? ''),
          syntaxHighlighting(markdownHighlight),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const next = update.state.doc.toString()
              valueRef.current = next
              changeRef.current(next)
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    view.focus()
    /*
     * 「定位源码」：选中那段源文并滚到眼前。之后用户可能立刻开始打字，
     * 光标该落在他要改的那一段上（取件规矩见上面 revealRef 的说明）。
     */
    if (reveal) {
      const len = view.state.doc.length
      const from = Math.max(0, Math.min(reveal.start, len))
      const to = Math.max(from, Math.min(reveal.end, len))
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
      view.focus()
    }
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // value / onChange / placeholder 都走 ref 或按初值：这只 effect 一辈子只跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 监听实时定位广播（支持已挂载实例再次跳转）
  useEffect(() => {
    return subscribeSourceReveal((key, rev) => {
      if (revealKey && key === revealKey && viewRef.current) {
        const view = viewRef.current
        const len = view.state.doc.length
        const from = Math.max(0, Math.min(rev.start, len))
        const to = Math.max(from, Math.min(rev.end, len))
        view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
        view.focus()
      }
    })
  }, [revealKey])

  // 外部改动（暂存被撤、外部文件被换）：与编辑器当前内容不一致才整段替换
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === view.state.doc.toString()) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  // 只读：走 compartment 重配，不重建实例
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyComp.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    })
  }, [readOnly])

  // 语言：按扩展名加载（异步——语言解析器是本地按需的 ESM 包）
  useEffect(() => {
    let alive = true
    void languageExtensions(ext).then((extensions) => {
      if (!alive) return
      viewRef.current?.dispatch({ effects: langComp.reconfigure(extensions) })
    })
    return () => {
      alive = false
    }
  }, [ext])

  // 字号系数：直接写在根元素上，与预览共用同一个设置
  useEffect(() => {
    const view = viewRef.current
    if (view) view.dom.style.fontSize = Math.round(15.6 * scale * 10) / 10 + 'px'
  }, [scale])

  const chars = countSourceWords(value)

  return (
    <div className="print-flat relative flex min-h-0 flex-1 flex-col bg-card">
      {/*
        字数与保存状态：排在右上角悬浮组的正下方（见 DocFloat 的 DocStatChip）。
        保存状态跟着字数一起搬——它俩本来就是同一条读数（「这份文档现在多大、存了没」），
        拆成两块钉在屏幕两侧会更难找。编辑模式统计的是源码字符，不是渲染后的可视字数。
      */}
      <DocStatChip title={label}>
        <span className="tabular-nums">{t('{0} 字', chars)}</span>
        <span className="h-3 w-px bg-line-strong/60" />
        <span
          className={STATE_TONE[state]}
          title={state === 'error' ? error : t(STATE_TEXT[state])}
        >
          {t(STATE_TEXT[state])}
        </span>
      </DocStatChip>

      {/*
        正文内边距走 .cm-content（见 editorTheme）：上下 20px、与左右同一尺度。
        右上那排悬浮按钮压着首行就压着——它平时是透明的，不占版面。
        下面那条统计也浮在正文上，但它比按钮更低一行，压不住首行。
      */}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  )
}

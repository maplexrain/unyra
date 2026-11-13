import { useCallback, useEffect, useRef, useState } from 'react'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  syntaxHighlighting,
  indentOnInput,
  indentUnit,
  bracketMatching,
  LanguageDescription,
  foldGutter,
  foldKeymap,
  foldEffect,
  unfoldEffect,
} from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages as codeLanguages } from '@codemirror/language-data'
import { countSourceWords } from '../../lib/wordCount'
import { getAppearance, setAppearance, clampEditorScale, SCALE_ZOOM_STEP, SCALE_HUD_MS } from '../../lib/appearance'
import { markdownEditorTheme, markdownHighlight } from '../../lib/cmMarkdown'
import { smoothCursor } from '../../lib/cmSmoothCursor'
import { scopeHighlight } from '../../lib/cmScopeHighlight'
import { vim } from '@replit/codemirror-vim'
import { isVimEnabled, subscribeVimEnabled } from '../../lib/vimSettings'
import { loadAndApplyVimrc } from '../../lib/vimConfig'
import { registerVimExCommands, setVimEditorBridge } from '../../lib/vimCommands'
import { foldCurrentScope, unfoldCurrentScope } from '../../lib/cmFoldScope'
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

/** 用于标记真实提交折叠、跳过收起动画拦截的事务标记 */
const skipFoldAnim = Annotation.define<boolean>()

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
 * 配色与主题在 lib/cmMarkdown（随笔窗口用的是同一份）：
 * gutterLeft 留出 50px 避让悬浮在左上角的垂直工具栏（left-3 + w-8），
 * 避免首行代码与按钮发生视觉重叠；代码正文与行号分隔线保持 14px 舒适内边距。
 */
const editorTheme = markdownEditorTheme({ top: 14, bottom: 24, left: 14, right: 24, gutterLeft: 50 })

/** 语言按扩展名现配（markdown 内嵌代码块也各自高亮）；其余扩展名交给 language-data 的表 */
const langComp = new Compartment()
const readOnlyComp = new Compartment()
const vimComp = new Compartment()

function getVimExtensions(enabled: boolean): Extension[] {
  if (!enabled) return []
  return [vim()]
}

function getInitialLanguageExtensions(ext?: string): Extension[] {
  if (!ext || /\.(md|markdown)$/i.test(ext)) return [markdown({ base: markdownLanguage, codeLanguages })]
  const desc = LanguageDescription.matchFilename(codeLanguages, 'x' + ext)
  if (desc?.support) return [desc.support]
  return []
}

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
  /** 允许由 Vim 冒号命令触发的页签关闭、分屏等宿主操作 */
  onCloseTab?: (force?: boolean) => void
  onCloseOtherTabs?: (force?: boolean) => void
  onSplitView?: (direction: 'horizontal' | 'vertical') => void
  onCustomSave?: (force?: boolean) => Promise<boolean | void> | boolean | void
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
  onCloseTab,
  onCloseOtherTabs,
  onSplitView,
  onCustomSave,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [vimActive, setVimActive] = useState<boolean>(() => isVimEnabled())
  const bridgeActionsRef = useRef({ onCloseTab, onCloseOtherTabs, onSplitView, onCustomSave })
  useEffect(() => {
    bridgeActionsRef.current = { onCloseTab, onCloseOtherTabs, onSplitView, onCustomSave }
  }, [onCloseTab, onCloseOtherTabs, onSplitView, onCustomSave])
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
    const foldingKeys = new Set<string>()

    const view = new EditorView({
      parent: hostRef.current ?? undefined,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          history(),
          keymap.of([
            // Ctrl- 与 Ctrl=：快速折叠/展开当前光标所在代码块（同时拦截默认网页缩放）
            {
              key: 'Mod--',
              run: (view) => {
                foldCurrentScope(view)
                return true
              },
            },
            {
              key: 'Mod-=',
              run: (view) => {
                unfoldCurrentScope(view)
                return true
              },
            },
            {
              key: 'Mod-_',
              run: (view) => {
                foldCurrentScope(view)
                return true
              },
            },
            {
              key: 'Mod-+',
              run: (view) => {
                unfoldCurrentScope(view)
                return true
              },
            },
            indentWithTab,
            ...closeBracketsKeymap,
            ...foldKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          // 左侧代码行号与光标当前行背景突出高亮
          lineNumbers(),
          highlightActiveLineGutter(),
          // 代码块折叠：支持 HTML 标签、JS/TS 函数、类、对象、Markdown 节等多语言代码块折叠，并注入平滑过渡动效
          foldGutter({
            markerDOM(open) {
              const el = document.createElement('span')
              el.className = `cm-fold-marker ${open ? 'cm-fold-marker-open' : 'cm-fold-marker-folded'}`
              el.setAttribute('aria-hidden', 'true')
              el.setAttribute('title', open ? '折叠代码块' : '展开代码块')
              el.innerHTML =
                '<svg class="cm-fold-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4" /></svg>'
              return el
            },
          }),
          // 拦截代码块折叠动作，在移除代码行前先执行平滑向上收起消散动效，消除瞬间收起突变感
          EditorState.transactionFilter.of((tr) => {
            if (tr.annotation(skipFoldAnim) || tr.docChanged) return tr
            const foldEff = tr.effects.find((e) => e.is(foldEffect))
            if (!foldEff) return tr

            const { from, to } = foldEff.value
            const key = `${from}:${to}`
            if (foldingKeys.has(key)) return []

            const view = viewRef.current
            if (!view) return tr

            const doc = tr.startState.doc
            if (from >= doc.length) return tr

            foldingKeys.add(key)
            const startLine = doc.lineAt(from).number
            const endLine = doc.lineAt(to).number

            // 对可视视口内即将折叠的行执行平滑向上收缩渐隐动画
            let maxDuration = 160
            try {
              const totalLines = Math.min(endLine, startLine + 35)
              for (let l = startLine + 1; l <= totalLines; l++) {
                try {
                  const line = doc.line(l)
                  const dom = view.domAtPos(line.from)
                  const el = ((dom.node.nodeType === 1 ? dom.node : dom.node.parentElement) as HTMLElement | null)?.closest?.('.cm-line') as HTMLElement | null
                  if (el) {
                    el.animate(
                      [
                        { opacity: 1, transform: 'translateY(0) scaleY(1)', transformOrigin: 'top center' },
                        { opacity: 0, transform: 'translateY(-8px) scaleY(0.9)', transformOrigin: 'top center' },
                      ],
                      {
                        duration: 160,
                        delay: Math.min((l - startLine - 1) * 6, 60),
                        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
                        fill: 'forwards',
                      },
                    )
                  }
                } catch {
                  // 视口外节点跳过
                }
              }
            } catch {
              maxDuration = 0
            }

            // 收起动画播完后，正式提交带有跳过动效标记的折叠事务
            window.setTimeout(() => {
              foldingKeys.delete(key)
              const v = viewRef.current
              if (!v) return
              if (from <= v.state.doc.length && to <= v.state.doc.length) {
                v.dispatch({
                  effects: foldEffect.of({ from, to }),
                  annotations: skipFoldAnim.of(true),
                })
              }
            }, maxDuration)

            return []
          }),
          // 专业选区绘制图层：在文本下层渲染平滑发光选区，完好保留各 Token 语法高亮
          drawSelection(),
          // 代码块（当前作用域）与当前光标行背景层次突出高亮
          scopeHighlight(),
          highlightActiveLine(),
          // 平滑移动的虚拟光标动画
          smoothCursor(),
          // 符号自动补全（输入 ( [ { " ' ` 自动带出另一半、跳过与删除成对）与括号配对高亮
          closeBrackets(),
          bracketMatching(),
          // 自动缩进：换行继承上一行的缩进，语言有语法的话按语法缩进；缩进单位是两个空格
          indentOnInput(),
          indentUnit.of('  '),
          EditorView.lineWrapping,
          vimComp.of(getVimExtensions(isVimEnabled())),
          readOnlyComp.of([]),
          langComp.of(getInitialLanguageExtensions(ext)),
          cmPlaceholder(placeholder ?? ''),
          syntaxHighlighting(markdownHighlight),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const next = update.state.doc.toString()
              valueRef.current = next
              changeRef.current(next)
              // 若当前编辑的文件即为 .vimrc，实时热应用最新配置
              if (label.endsWith('.vimrc') || label.endsWith('_vimrc') || ext === '.vimrc') {
                loadAndApplyVimrc(next).catch(() => {})
              }
            }
            // 监听代码块展开动作，为新展示的代码行注入瀑布级平滑渐显与位移下移动画
            for (const tr of update.transactions) {
              for (const effect of tr.effects) {
                if (effect.is(unfoldEffect)) {
                  const { from, to } = effect.value
                  requestAnimationFrame(() => {
                    const view = viewRef.current
                    if (!view) return
                    const startLine = view.state.doc.lineAt(from).number
                    const endLine = view.state.doc.lineAt(to).number
                    for (let l = startLine + 1; l <= Math.min(endLine, startLine + 35); l++) {
                      try {
                        const line = view.state.doc.line(l)
                        const dom = view.domAtPos(line.from)
                        const el = ((dom.node.nodeType === 1 ? dom.node : dom.node.parentElement) as HTMLElement | null)?.closest?.('.cm-line') as HTMLElement | null
                        if (el) {
                          el.animate(
                            [
                              { opacity: 0, transform: 'translateY(-6px)' },
                              { opacity: 1, transform: 'translateY(0)' },
                            ],
                            {
                              duration: 220,
                              delay: Math.min((l - startLine - 1) * 12, 100),
                              easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                              fill: 'both',
                            },
                          )
                        }
                      } catch {
                        // 视口外行节点静默跳过
                      }
                    }
                  })
                }
              }
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
    // 增强 Vim 翻页滚动为丝滑过渡动画 (Ctrl+U / Ctrl+D)
    const patchSmoothVimScroll = (v: EditorView) => {
      const cm = (v as any).cm
      if (cm && !cm.__smoothScrollPatched) {
        cm.__smoothScrollPatched = true
        const origScrollTo = cm.scrollTo?.bind(cm)
        cm.scrollTo = (x: number | null, y: number | null) => {
          const scroller = v.scrollDOM
          if (!scroller || typeof scroller.scrollTo !== 'function') {
            origScrollTo?.(x, y)
            return
          }
          scroller.scrollTo({
            left: x != null ? x : scroller.scrollLeft,
            top: y != null ? y : scroller.scrollTop,
            behavior: 'smooth',
          })
        }
      }
    }

    patchSmoothVimScroll(view)

    // 注册应用级 Vim 冒号命令并挂载当前编辑器的动作桥接
    registerVimExCommands()
    setVimEditorBridge({
      getView: () => viewRef.current,
      onSave: (force) => bridgeActionsRef.current.onCustomSave?.(force),
      onClose: (force) => bridgeActionsRef.current.onCloseTab?.(force),
      onCloseOthers: (force) => bridgeActionsRef.current.onCloseOtherTabs?.(force),
      onSplit: (direction) => bridgeActionsRef.current.onSplitView?.(direction),
    })

    // 初始化挂载时若已开启 Vim，立即加载并执行 ~/.vimrc
    if (isVimEnabled()) {
      patchSmoothVimScroll(view)
      loadAndApplyVimrc().catch(() => {})
    }

    const unsubVim = subscribeVimEnabled((enabled) => {
      setVimActive(enabled)
      const v = viewRef.current
      if (!v) return
      v.dispatch({
        effects: vimComp.reconfigure(getVimExtensions(enabled)),
      })
      if (enabled) {
        patchSmoothVimScroll(v)
        loadAndApplyVimrc().catch(() => {})
      }
    })

    return () => {
      setVimEditorBridge(null)
      unsubVim()
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
    if (view) view.dom.style.fontSize = Math.round(14.04 * scale * 10) / 10 + 'px'
  }, [scale])

  const [zoomPct, setZoomPct] = useState(() => Math.round((scale ?? 1) * 100))
  const [zoomHud, setZoomHud] = useState(false)
  const zoomTimer = useRef<number | null>(null)

  useEffect(() => {
    setZoomPct(Math.round((scale ?? 1) * 100))
  }, [scale])

  // Ctrl + 滚轮调节编辑模式源码字号
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 3 : 100
      const notches = Math.max(-3, Math.min(3, -e.deltaY / unit))
      if (!notches) return
      const prev = getAppearance().editorScale
      const next = clampEditorScale(prev * SCALE_ZOOM_STEP ** notches)
      if (next !== prev) {
        setAppearance({ ...getAppearance(), editorScale: next })
      }
      setZoomPct(Math.round(next * 100))
      setZoomHud(true)
      if (zoomTimer.current !== null) window.clearTimeout(zoomTimer.current)
      zoomTimer.current = window.setTimeout(() => {
        zoomTimer.current = null
        setZoomHud(false)
      }, SCALE_HUD_MS)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (zoomTimer.current !== null) window.clearTimeout(zoomTimer.current)
    }
  }, [])

  const chars = countSourceWords(value)

  return (
    <div className="print-flat relative flex min-h-0 flex-1 flex-col bg-card moji-tab-transition">
      {/*
        字数与保存状态：排在右上角悬浮组的正下方（见 DocFloat 的 DocStatChip）。
        保存状态跟着字数一起搬——它俩本来就是同一条读数（「这份文档现在多大、存了没」），
        拆成两块钉在屏幕两侧会更难找。编辑模式统计的是源码字符，不是渲染后的可视字数。
      */}
      <DocStatChip title={label}>
        {vimActive && (
          <>
            <span className="font-mono text-[11px] font-bold text-seal select-none">VIM</span>
            <span className="h-3 w-px bg-line-strong/60" />
          </>
        )}
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
      {/* 右下角字号比例提示 */}
      <div
        aria-hidden={!zoomHud}
        className={
          'pointer-events-none absolute bottom-5 right-5 z-20 flex items-center gap-1.5 rounded-full border border-line-strong/80 bg-card/90 px-3 py-1 shadow-md backdrop-blur transition-opacity duration-200 select-none ' +
          (zoomHud ? 'opacity-100' : 'opacity-0')
        }
      >
        <span className="text-[13px] font-medium tabular-nums text-ink-strong">{zoomPct}%</span>
      </div>

    </div>
  )
}

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { AnnotationStyle, DocKind, KnowledgeNode } from '../../learn/types'
import type { LocalImageResolver } from '../../lib/docImages'
import { canAnnotate } from '../../lib/annotation'
import { renderNote } from '../../lib/markdown'
import { maskChipTokens, restoreChipTokens } from '../../lib/chipSyntax'
import { countVisibleWords, countVisibleWordsFromHtml } from '../../lib/wordCount'
import type { OutlineHandle } from '../../lib/outline'
import { DocBody } from './note/DocBody'
import { DocContextMenu } from './note/docContextMenu'
import { useDocContextMenu, type SourceSpan } from './note/useDocContextMenu'
import { useAnnotationLayer } from './note/useAnnotationLayer'
import { useDocOutline, useDocScrollMemory, useDocZoom } from './note/useDocView'
import { useQuoteHighlight } from './note/useQuoteHighlight'
import { useSelectionMenu } from './note/useSelectionMenu'
import { SelectionMenuPopup, type MenuAction } from './note/selectionMenu'
import { t } from '../../i18n'

/**
 * 正在看的那份文档：类型 + 正文（笔记带上它的名字）。
 *
 * 正文由**上层**算好传进来，而不是在这里从 node 上现取：一个节点可以有多份笔记，
 * 「现在看的是哪一份」只有页签知道（见 learn/types 的 LearnTab）；本组件退化成
 * 「把给我的这段 Markdown 渲染出来」，也就能同时服务于教学文档与任意一份笔记。
 */
export interface DocSource {
  kind: DocKind
  /** 笔记名；教学文档没有这一项 */
  note?: string
  content: string
}

interface Props {
  node: KnowledgeNode
  /** 正在看哪一份文档 */
  doc: DocSource
  /** 这份文档还在等 Agent 写：为空时文档区显示等待动画，不给用户一片空白 */
  pending?: boolean
  /** 当前 Agent 是否正在运行 */
  agentRunning?: boolean
  /** 触发生成教学文档。带 node 参数：上层因此能传一份身份稳定的回调（见 LearnWorkspace） */
  onGenerateDoc?: (node: KnowledgeNode) => void
  /** 选中词条 → 展开一个下级节点（深入学习） */
  onLearnConcept: (term: string) => void
  /** 选中词条 → 只在原文挂一段短释义（了解），不改动知识树 */
  /** 「了解」：把词条、出现序号与选中的原文交给上层（它去跑工作流，见 LearnWorkspace） */
  onUnderstand: (term: string, occurrence: number, snippet?: string) => void
  /** 选中一段文字 → 就该段向 AI 提问（带源文位置，便于 Agent 精确定位） */
  onAsk: (payload: {
    question: string
    text: string
    start?: number
    end?: number
  }) => void | Promise<void>
  /** 保存一条自己写的注解（Markdown + 样式）；同一词条再次保存即覆盖 */
  onSaveAnnotation?: (term: string, body: string, style?: AnnotationStyle, occurrence?: number) => void
  /** 删除某词条上的注解 */
  onDeleteAnnotation?: (term: string) => void
  /**
   * 正文被就地改了一段（右键菜单的「粘贴」）：上层把它记进暂存区（见 learn/drafts）。
   * 预览本来是只读的，只有这一条路会写正文——用户自己按的粘贴，不算偷偷改。
   */
  onEditContent?: (next: string) => void
  /**
   * 「定位源码」：把选区在源文里的位置交给上层，由它切到源码视图
   * （切视图是页签上的选择，见 LearnWorkspace 的 setTabView；选中由 lib/docReveal 递过去）。
   */
  onRevealSource?: (loc: SourceSpan) => void
  /** 提示一句话（词条已不在正文里等）；由上层接到全局 toast 上 */
  onWarn?: (message: string) => void
  /** 当前目标内已存在节点的归一化 key 集合：用于区分「已创建/未创建」的学习链接 */
  knownConceptKeys?: Set<string>
  /**
   * 就地图片解析器（见 lib/docImages）：这份文档目录旁边的图片（相对路径引用）据此显示。
   * 由上层按「这一份文档自己的目录」注入——常驻的多片正文各是各的文档，不能共用一个「当前目录」。
   */
  resolveLocalImage?: LocalImageResolver
  /**
   * 这一片正文此刻是不是在眼前（页签常驻之后，非当前页签也挂在那里，只是不显示）。
   *
   * 它只关两件事：目录栏宽度的量法、以及有效阅读的采集。两件事都怕「隐藏」——
   * 隐藏时 clientWidth 是 0（会把目录栏误判成放不下），阅读采集更不该给看不见的文档计时。
   * 其余一切照旧：DOM 留着、滚动位置留着、注解留着，这正是常驻要的。
   */
  active?: boolean
  /**
   * 文档栏是不是在中间主位（导师栏占着主位时为 false）。
   *
   * 不在主位那段时间不做某些事（如目录栏宽度的量法）；这一层能拿到真实几何。
   * 缺省 true：没有这个概念的调用方照旧。
   */
  /**
   * 大纲句柄槽（见 lib/outline 的 OutlineHandle）：本组件把算好的大纲、当前读到哪一节
   * 与跳转能力装进去，文档区右上角悬浮组的「标题大纲」按钮据此弹出浮层（见 DocFloat）。
   * 大纲跟着滚动时时变化，装在 ref 槽里就不必为它重渲染工作区。
   */
  outlineSlot?: { current: OutlineHandle | null }
  /** 上一次读到哪儿（px）：**第一次显示出来**时恢复一次，见 lib/docScroll */
  scrollTop?: number
  /** 滚动到哪儿了的上报（上层节流写盘；不写的话下次打开又从头开始） */
  onScrollTop?: (top: number) => void
}

/**
 * 节点文档区：单向只读的 Markdown 渲染。文档切换的标签在上面的 DocBar 里，
 * 换一份文档由上层换掉本组件的 key 来重挂（见 LearnWorkspace 的 NodeNote key），
 * 于是选中菜单、注解窗口这些「照着某一份文档的选区开的」浮层不会跨文档残留。
 *
 * 一个节点的教学文档与每一份笔记都是平级的：各有各的落盘文件、各自被单独改写，
 * 文档之间用 moji:doc 链接互跳。本组件不区分它们是谁——渲染的就是上层给的那一份。
 *
 * 用解析库（marked + KaTeX + DOMPurify）把源文渲染成静态 HTML，
 * 因此不存在「点击後回落源码」这回事，也没有任何编辑入口。仍支持选中文字：
 * 学习（建下级节点）、了解（AI 释义）、注解（自己写批注）、询问（提问）。
 */
export default memo(function NodeNote({
  node,
  doc,
  pending = false,
  agentRunning = false,
  onGenerateDoc,
  onLearnConcept,
  onUnderstand,
  onAsk,
  onSaveAnnotation,
  onDeleteAnnotation,
  onEditContent,
  onRevealSource,
  onWarn,
  knownConceptKeys,
  resolveLocalImage,
  active = true,
  scrollTop,
  onScrollTop,
  outlineSlot,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** 正文滚动容器：标题定位要滚的是它，而不是整个文档区 */
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  /** 当前文档的正文（由上层给：见 DocSource 的说明） */
  const content = doc.content
  const html = useMemo(() => {
    const { masked, tokens } = maskChipTokens(content)
    return restoreChipTokens(renderNote(masked), tokens)
  }, [content])

  /**
   * 词条还注解得了吗。两种不放行的情况：
   * - 词条为空：选区整个落在公式/图形里，一处正文文字都没有；
   * - 在正文里匹配不上：多是把注解窗口开着的这段时间里，正文被 AI 重写了。
   *   这种注解存下去会静静地永远不显示，不如当场说清楚。
   *
   * 判断必须落在**渲染结果**上：词条是跨元素选出来的，源文里根本没有这一段连续文字
   * （中间隔着 **、[](…)、公式），早先拿源文 includes 去判，正常选择也会被误拦。
   */
  const cannotAnnotate = (term: string): boolean => {
    const body = bodyRef.current
    if (!term) {
      onWarn?.(t('选中的内容里没有可注解的文字'))
      return true
    }
    if (!body || !canAnnotate(body, term)) {
      onWarn?.(t('该词已不在正文中，无法注解'))
      return true
    }
    return false
  }

  /*
   * 选词菜单：状态与全部接线（弹出、收起、定位、数字键）见 note/useSelectionMenu；
   * 返回的名字与原地的局部变量一一对应，点下去做什么仍在下面那一个 switch 里。
   */
  const {
    menu,
    menuRef,
    inputRef,
    asking,
    setAsking,
    question,
    setQuestion,
    menuMounted,
    menuClosing,
    setMenuOpen,
    dismiss,
  } = useSelectionMenu({ bodyRef, content, html })

  /*
   * 右键菜单（复制 / 粘贴 / 定位源码）：接线与三个动作的落地见 note/useDocContextMenu。
   * 「粘贴」要拼新正文，就在这里拼完再交给上层——上层只管把它记进暂存区（onEditContent）。
   * 定位源码则由上层切视图（那是页签上的选择，本组件不认识页签）。
   */
  const {
    menu: ctxMenu,
    menuRef: ctxMenuRef,
    mounted: ctxMenuMounted,
    closing: ctxMenuClosing,
    close: ctxMenuClose,
    runCopy: ctxCopy,
    runPaste: ctxPaste,
    runReveal: ctxReveal,
  } = useDocContextMenu({
    bodyRef,
    content,
    onInsert: (text, loc) => onEditContent?.(content.slice(0, loc.start) + text + content.slice(loc.end)),
    onRevealSource,
    onError: onWarn,
    onCopied: () => onWarn?.(t('已复制为 Markdown')),
  })

  /*
   * 文档视图：正文大纲与当前读到哪一节、Ctrl + 滚轮的字号、读到哪儿了。
   * 三件事各交给一只钩子（见 note/useDocView），这里只做接线。
   */
  const { outline, activeIndex, jumpTo } = useDocOutline({ bodyRef, scrollRef, html })
  const { docScale, zoomPct, zoomHud } = useDocZoom({ rootRef, bodyRef, scrollRef })
  useDocScrollMemory({ scrollRef, scrollTop, onScrollTop, active, nodeId: node.id, docKind: doc.kind, docNote: doc.note })

  /*
   * 大纲句柄装进槽里。不设依赖：jumpTo 每次渲染都是新的，每轮渲染重装一次最省心，
   * 反正只是一次对象赋值。卸载时清掉，免得悬浮组弹出一个已经不存在的文档的大纲。
   */
  useEffect(() => {
    if (outlineSlot) outlineSlot.current = outline.length ? { items: outline, activeIndex, jump: jumpTo } : null
  })
  useEffect(() => {
    const slot = outlineSlot
    return () => {
      if (slot) slot.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 引文高亮：点对话气泡里的选段 → 回到正文里把对应文字闪一下（见 note/useQuoteHighlight）
  useQuoteHighlight({ bodyRef, content, html })

  const doLearn = () => {
    if (!menu) return
    const term = menu.text
    dismiss()
    onLearnConcept(term)
  }

  const doUnderstand = () => {
    if (!menu) return
    const term = menu.term
    // 选段一并交给导师：它不必为了看一眼这个词先读整篇（序号仍以 term 为准）
    const snippet = menu.text
    dismiss()
    if (cannotAnnotate(term)) return
    onUnderstand(term, menu.occurrence, snippet)
  }

  const submitAsk = () => {
    if (!menu) return
    const q = question.trim()
    if (!q) return
    const { text, loc } = menu
    setAsking(false)
    setQuestion('')
    setMenuOpen(false)
    // 保留选区，便于用户回看自己问的是哪一段
    void onAsk({ question: q, text, start: loc?.start, end: loc?.end })
  }

  /**
   * 一项真正做什么。列表里只放**长相**（名字、图标、提示），动作收在这一个 switch 里：
   * 它们要读 ref（见 cannotAnnotate）、要改状态，散在数组里既不好读，
   * 也会让「渲染」与「做事」两份东西各走各的。
   */
  const runAction = (key: MenuAction['key']): void => {
    if (key === 'learn') return doLearn()
    if (key === 'understand') return doUnderstand()
    if (key === 'ask') return setAsking(true)
    // 注解：用 term（按选区 DOM 重取的词条）而不是 text——跨元素选择时 text 里混着
    // 公式的排版字符，存下来永远匹配不上正文；occurrence 一并带上，同一个词出现
    // 好几回时要标的是用户划的那一处
    const term = menu?.term ?? ''
    const at = menu?.occurrence ?? 0
    dismiss()
    openNote(term, at)
  }

  // 预览模式只统计实际渲染呈现给用户的可视文字（过滤 Markdown/HTML/LaTeX 语法符号）
  const [wordCount, setWordCount] = useState(() => countVisibleWordsFromHtml(html))
  useEffect(() => {
    if (bodyRef.current) {
      setWordCount(countVisibleWords(bodyRef.current, html))
    }
  }, [html])

  /*
   * 注解输入区：开合、保存/删除、样式预览与它自己的 JSX 都在 note/useAnnotationLayer。
   * 词条校验用上面那个 cannotAnnotate（「了解」那条路也用它，口径只有一份）。
   */
  const { dialog: noteDialogEl, openNote, annotationActions } = useAnnotationLayer({
    annotations: node.annotations,
    bodyRef,
    cannotAnnotate,
    onSaveAnnotation,
    onDeleteAnnotation,
  })

  /*
   * 交给 DocBody 的「生成教学文档」零参回调。
   *
   * DocBody 的比较器显式比这个 prop，所以它必须**每轮都是同一个身份**：
   * 上层给的是稳定的 (node) => void，node 在 store 不变时也是同一个对象，
   * 于是这里 useMemo 出来的闭包一直复用；否则每次工作区渲染都会把正文重渲一遍。
   */
  const generateDoc = useMemo(
    () => (onGenerateDoc ? () => onGenerateDoc(node) : undefined),
    [onGenerateDoc, node],
  )

  return (
    <div ref={rootRef} className="print-flat relative flex min-h-0 flex-1 flex-col bg-card">
      {/* 正文。文档切换的标签不在这里——它在文档区顶上的
          DocBar 那一行里，与试卷入口同行（见 LearnWorkspace） */}
      <div className="print-flat flex min-h-0 flex-1 flex-col">
        {/* 正文那一整块（滚动容器、正文、占位、页脚）见 note/DocBody */}
        <DocBody
          scrollRef={scrollRef}
          bodyRef={bodyRef}
          docScale={docScale}
          pending={pending}
          agentRunning={agentRunning}
          onGenerateDoc={generateDoc}
          kind={doc.kind}
          content={content}
          html={html}
          annotations={node.annotations}
          knownConceptKeys={knownConceptKeys}
          annotationActions={annotationActions}
          resolveLocalImage={resolveLocalImage}
          wordCount={wordCount}
          // 选词菜单浮在正文这一层上：位置与开合仍由本组件管（见 note/useSelectionMenu）
          overlay={
            menuMounted && (
              <SelectionMenuPopup
                menu={menu}
                pending={pending}
                menuRef={menuRef}
                inputRef={inputRef}
                asking={asking}
                question={question}
                setQuestion={setQuestion}
                setAsking={setAsking}
                menuClosing={menuClosing}
                runAction={runAction}
                submitAsk={submitAsk}
              />
            )
          }
        />

        {/* 注解输入区（见 note/useAnnotationLayer）：它占位地待在正文列底部 */}
        {noteDialogEl}
      </div>

      {/* 正文的右键菜单（复制 / 粘贴 / 定位源码）：fixed 定位，挂在根节点上而不是正文里，
          免得被滚动容器的 overflow 裁掉（见 note/useDocContextMenu） */}
      {ctxMenuMounted && (
        <DocContextMenu
          menu={ctxMenu}
          menuRef={ctxMenuRef}
          closing={ctxMenuClosing}
          canPaste={!!onEditContent}
          canReveal={!!onRevealSource}
          onCopy={ctxCopy}
          onPaste={ctxPaste}
          onReveal={ctxReveal}
          onClose={ctxMenuClose}
        />
      )}

      {/*
        字号比例提示：贴在文档区右下角、页脚之上。
        常挂不卸载、只切透明度，进出都平滑，也省掉一套退场时序。
      */}
      <div
        aria-hidden={!zoomHud}
        className={`no-print pointer-events-none absolute bottom-11 right-4 flex items-baseline gap-1.5 rounded-lg border border-line-strong bg-card/95 px-3 py-1.5 shadow-[0_6px_20px_rgba(31,27,23,0.12)] transition-opacity duration-300 ${
          zoomHud ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <span className="text-[10.5px] text-ink-faint">{t('字号')}</span>
        <span className="text-[13px] font-medium tabular-nums text-ink-strong">{zoomPct}%</span>
      </div>

    </div>
  )
})

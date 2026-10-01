import { useEffect, useMemo, useRef } from 'react'
import type { AnnotationStyle, DocKind, KnowledgeNode } from '../../learn/types'
import type { LocalImageResolver } from '../../lib/docImages'
import { canAnnotate } from '../../lib/annotation'
import { renderNote } from '../../lib/markdown'
import { useReadingTracker } from '../../learn/useReadingTracker'
import { readingDocKey, type ReadingDelta } from '../../learn/reading'
import type { OutlineHandle } from '../../lib/outline'
import ReadingPulse from './ReadingPulse'
import { DocBody } from './note/DocBody'
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
  /** 提示一句话（词条已不在正文里等）；由上层接到全局 toast 上 */
  onWarn?: (message: string) => void
  /** 当前目标内已存在节点的归一化 key 集合：用于区分「已创建/未创建」的学习链接 */
  knownConceptKeys?: Set<string>
  /** 有效阅读的增量（见 learn/reading）；由上层安静写进 store，不参与渲染 */
  onReading?: (delta: ReadingDelta) => void
  /**
   * 就地图片解析器（见 lib/docImages）：这份文档目录旁边的图片（相对路径引用）据此显示。
   * 由上层按「这一份文档自己的目录」注入——常驻的多片正文各是各的文档，不能共用一个「当前目录」。
   */
  resolveLocalImage?: LocalImageResolver
  /** 这份文档此刻不算「前台」（例如考试窗口开着）：采集器停表 */
  readingPaused?: boolean
  /**
   * 今天这份文档有没有阅读记录。今天还没读过时，采集器要先过「动过 + 读够 20 秒」
   * 的门槛才开始记账（见 learn/reading 的 readToday / warmupDone）。
   */
  readingKnownToday?: () => boolean
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
   * 不在主位那段时间不算有效阅读：窄栏里「跟着看」的时间可以丢（见 useReadingTracker）。
   * 缺省 true：没有这个概念的调用方照旧。
   */
  mainPane?: boolean
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
export default function NodeNote({
  node,
  doc,
  pending = false,
  onLearnConcept,
  onUnderstand,
  onAsk,
  onSaveAnnotation,
  onDeleteAnnotation,
  onWarn,
  knownConceptKeys,
  onReading,
  resolveLocalImage,
  readingPaused = false,
  readingKnownToday,
  active = true,
  mainPane = true,
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
  const html = useMemo(() => renderNote(content), [content])

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
    markReading('learn')
    onLearnConcept(term)
  }

  const doUnderstand = () => {
    if (!menu) return
    const term = menu.term
    // 选段一并交给导师：它不必为了看一眼这个词先读整篇（序号仍以 term 为准）
    const snippet = menu.text
    dismiss()
    if (cannotAnnotate(term)) return
    // 「了解」是「真读了」的强证据：注意力评级里算 depth（见 learn/attention）
    markReading('annotate')
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
    markReading('ask')
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

  const wordCount = content.replace(/\s/g, '').length

  /*
   * 有效阅读的采集（见 learn/useReadingTracker）。放在这里是因为「有效」要看的东西
   * 全在这一层：滚动容器、正文 DOM、窗口焦点……store 只该收到结论。
   * 没有注入 onReading（例如预览场景）时它自动变成空转：tracker 照常跑，
   * 增量没人接就丢掉了，不值得为它多开一条分支。
   */
  const { mark: markReading } = useReadingTracker({
    nodeId: node.id,
    // 阅读账按目标分开（见 learn/reading 的 ReadingBook）：采集器要把它一起带走
    goalId: node.goalId,
    doc: readingDocKey(doc.kind, doc.note),
    words: wordCount,
    // 传函数而不是元素：渲染期读 ref 会被 React 的规则拦下（而且首帧它们还是 null）
    body: () => bodyRef.current,
    scroll: () => scrollRef.current,
    content,
    // 不是当前页签就不计时：常驻的隐藏页既没在眼前，也没有真实的几何可量
    active: active && !readingPaused && !pending,
    // 导师正在把这份文档写出来（空文档 + 正在生成）：那段时间不算读
    busy: pending,
    // 笔记不记有效阅读：那里是动手写的地方，写多久都不算「在读」（用户定的）
    count: doc.kind !== 'note',
    // 导师栏占着中间主位时不算阅读（窄栏里跟读的时间直接丢，见 useReadingTracker）
    mainPane,
    knownToday: () => readingKnownToday?.() ?? true,
    onDelta: (delta: ReadingDelta) => onReading?.(delta),
  })

  /*
   * 注解输入区：开合、保存/删除、样式预览与它自己的 JSX 都在 note/useAnnotationLayer。
   * 词条校验用上面那个 cannotAnnotate（「了解」那条路也用它，口径只有一份）。
   */
  const { dialog: noteDialogEl, openNote, annotationActions } = useAnnotationLayer({
    annotations: node.annotations,
    bodyRef,
    cannotAnnotate,
    markReading,
    onSaveAnnotation,
    onDeleteAnnotation,
  })

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

        {/* 有效阅读的脉搏：文档区最左边那一条 2px（见 components/learn/ReadingPulse） */}
        <ReadingPulse />

        {/* 注解输入区（见 note/useAnnotationLayer）：它占位地待在正文列底部 */}
        {noteDialogEl}
      </div>

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
}

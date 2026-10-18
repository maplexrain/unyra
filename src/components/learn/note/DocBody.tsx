/**
 * 这个文件负责什么：正文那一块——滚动容器、正文本身（MarkdownView 渲染出来的 HTML）、
 * 正文还没来 / 笔记还空着时的两种占位，以及右上角悬浮组下方那条字数统计
 * （见 DocFloat 的 DocStatChip）。
 *
 * 它不碰任何状态：字号系数、正文 HTML、注解都从上层传进来（见 NodeNote）。
 * 选词菜单是浮在正文上的，但定位与开合都不在这里——它作为 overlay 插回原来那一层，
 * 免得把它挪出正文区之后 fixed 定位的夹取与滚动容器的关系变了。
 */
import { memo, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { BookOpen, Sparkles } from 'lucide-react'
import MarkdownView from '../../MarkdownView'
import WaveBars from '../../WaveBars'
import type { Annotation, DocKind } from '../../../learn/types'
import type { AnnotationActions } from '../../../lib/annotation'
import type { LocalImageResolver } from '../../../lib/docImages'
import { copySelectionAsMarkdown } from '../../../lib/copySource'
import { DocStatChip } from '../DocFloat'
import ZenResizeHandles from '../workspace/ZenResizeHandles'
import { t } from '../../../i18n'

interface Props {
  /** 正文滚动容器：滚动位置的恢复与上报、标题定位都指着它 */
  scrollRef: RefObject<HTMLDivElement | null>
  /** 正文根节点：选词、注解、引文高亮都在它上面量 */
  bodyRef: RefObject<HTMLDivElement | null>
  /** 正文字号系数（Ctrl + 滚轮改，见 note/useDocView 的 useDocZoom） */
  docScale: number
  /** 这份文档还在等 Agent 写：为空时显示等待动画，不给用户一片空白 */
  pending: boolean
  /** 当前 Agent 是否正在运行 */
  agentRunning?: boolean
  /** 触发生成教学文档 */
  onGenerateDoc?: () => void
  /** 正在看的是哪一类文档：空的笔记与空的正文要说的不是一回事 */
  kind: DocKind
  content: string
  /** renderNote 产出的 HTML */
  html: string
  /** 「了解」/「注解」：渲染后在 DOM 上把术语包成虚线样式 */
  annotations: Annotation[]
  /** 当前目标内已存在节点的归一化 key 集合 */
  knownConceptKeys?: Set<string>
  /** 注解浮层里「修改/删除」的回调 */
  annotationActions: AnnotationActions
  /** 就地图片解析器（见 lib/docImages）：文档目录旁的相对路径图片据此显示；上层按文档注入 */
  resolveLocalImage?: LocalImageResolver
  /** 正文字数（去掉空白）：右上角那条统计用（见 DocStatChip） */
  wordCount: number
  /** 浮在正文这一层上的东西（选词菜单）：位置与开合由上层管，这里只负责插回原位 */
  overlay?: ReactNode
}

function sameConceptKeys(a?: Set<string>, b?: Set<string>): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.size !== b.size) return false
  for (const k of a) {
    if (!b.has(k)) return false
  }
  return true
}

function sameAnnotations(a?: Annotation[], b?: Annotation[]): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.term !== y.term || x.body !== y.body || x.kind !== y.kind || x.occurrence !== y.occurrence) {
      return false
    }
  }
  return true
}

function areDocBodyPropsEqual(prev: Props, next: Props): boolean {
  if (prev.html !== next.html) return false
  if (prev.content !== next.content) return false
  if (prev.docScale !== next.docScale) return false
  if (prev.pending !== next.pending) return false
  if (prev.agentRunning !== next.agentRunning) return false
  if (prev.onGenerateDoc !== next.onGenerateDoc) return false
  if (prev.kind !== next.kind) return false
  if (prev.wordCount !== next.wordCount) return false
  if (prev.overlay !== next.overlay) return false
  if (prev.resolveLocalImage !== next.resolveLocalImage) return false
  if (prev.scrollRef !== next.scrollRef || prev.bodyRef !== next.bodyRef) return false
  if (!sameAnnotations(prev.annotations, next.annotations)) return false
  if (!sameConceptKeys(prev.knownConceptKeys, next.knownConceptKeys)) return false
  return true
}

export const DocBody = memo(function DocBody({
  scrollRef,
  bodyRef,
  docScale,
  pending,
  agentRunning,
  onGenerateDoc,
  kind,
  content,
  html,
  annotations,
  knownConceptKeys,
  annotationActions,
  resolveLocalImage,
  wordCount,
  overlay,
}: Props) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 字数统计：排在右上角悬浮组的正下方（见 DocFloat 的 DocStatChip） */}
      <DocStatChip>
        <span className="tabular-nums">{t('{0} 字', wordCount)}</span>
      </DocStatChip>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* 左侧留白给得多一点：标题定位栏就在旁边，正文（以及跳转高亮的底色）不贴过去 */}
        <div className="doc-measure relative flex min-h-full flex-col pt-6 pl-[32px] pr-[22px]">
          <ZenResizeHandles />
          {/* 教学文档尚未生成或正在生成时的美观静态占位 */}
          {kind === 'teaching' && !content.trim() && (
            <EmptyTeachingDoc
              pending={pending || agentRunning}
              onGenerate={onGenerateDoc}
            />
          )}

          {/* 空的笔记：说清它可以怎么被填上，而不是留一片白 */}
          {!pending && kind === 'note' && !content.trim() && <EmptyNote />}

          {/* --doc-scale 是正文唯一的字号系数，index.css 里所有排版都按它等比缩放 */}
          {/*
            复制走源文：在预览里选中一段，进剪贴板的应当是它在 Markdown 里的原文
            （公式的渲染产物、注解标记、视觉换行都不该跟着走，见 lib/copySource）；
            映射不出来时它自己放行，默认复制照旧。
          */}
          <div
            ref={bodyRef}
            className="note-preview moji-node-note"
            style={{ '--doc-scale': docScale } as CSSProperties}
            onCopy={(e) => copySelectionAsMarkdown(e, bodyRef.current, content)}
          >
            <MarkdownView
              html={html}
              annotations={annotations}
              knownConceptKeys={knownConceptKeys}
              annotationActions={annotationActions}
              resolveLocalImage={resolveLocalImage}
            />
          </div>

          {overlay}
        </div>
      </div>
    </div>
  )
}, areDocBodyPropsEqual)

/**
 * 空的笔记文档。
 *
 * 笔记不像教学文档那样「总会有人写」：它多数时候是空的。空着的时候要说清这一份是干什么的、
 * 怎么才会被填上——否则用户点过来只看到一片白，会以为是加载失败。
 */
function EmptyNote() {
  return (
    <div className="moji-in-soft mb-6 rounded-xl border border-dashed border-line-strong/70 bg-paper/40 px-4 py-3.5">
      <div className="text-[13px] font-medium text-ink">{t('这里还没有笔记')}</div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
        {t('在右侧对话里说一句「把刚才讲的要点整理进我的笔记」，导师就会写到这里； 选中正文里的词条写「注解」，那条批注会跟着正文显示，不会进这份文档。')}
      </p>
    </div>
  )
}

interface EmptyTeachingDocProps {
  pending?: boolean
  onGenerate?: () => void
}

/**
 * 空的教学文档占位：
 * 采用美观静态元素进行结构化排版占位，避免刺眼的移动骨架屏。
 * 若 Agent 尚未运行，展示「生成教学文档」操作按钮供用户一键生成。
 */
function EmptyTeachingDoc({ pending, onGenerate }: EmptyTeachingDocProps) {
  if (pending) {
    return (
      <div className="moji-in-soft mb-8 flex min-h-0 flex-1 flex-col items-center justify-center py-12 px-6 text-center select-none">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-seal/10 text-seal">
          <BookOpen size={28} className="stroke-[1.75]" />
        </div>
        <div className="flex items-center gap-2 text-[15px] font-semibold text-ink-strong">
          <WaveBars className="text-seal" />
          <span>{t('超级导师正在编写教学文档…')}</span>
        </div>
        <p className="mt-2 max-w-md text-[12.5px] leading-relaxed text-ink-faint">
          {t('正在结合知识脉络与权威资料为当前节点编写系统化讲义；等待期间可在右侧对话中继续提问。')}
        </p>
        {/* 美观的静态结构占位元素（无骨架闪烁动画） */}
        <div
          className="mt-8 flex w-full max-w-md flex-col gap-3 rounded-xl border border-dashed border-line-strong/30 bg-paper/40 p-5 text-left"
          aria-hidden="true"
        >
          <div className="h-4 w-1/3 rounded bg-line-strong/20" />
          <div className="h-3 w-5/6 rounded bg-line-strong/10" />
          <div className="h-3 w-4/6 rounded bg-line-strong/10" />
          <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line-strong/20 bg-card/50 p-3.5">
            <div className="h-3.5 w-1/4 rounded bg-seal/20" />
            <div className="h-2.5 w-full rounded bg-line-strong/10" />
            <div className="h-2.5 w-4/5 rounded bg-line-strong/10" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="moji-in-soft mb-8 flex min-h-0 flex-1 flex-col items-center justify-center py-12 px-6 text-center select-none">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-seal/10 text-seal">
        <BookOpen size={28} className="stroke-[1.75]" />
      </div>
      <div className="text-[15px] font-semibold text-ink-strong">
        {t('教学文档尚未生成')}
      </div>
      <p className="mt-2 max-w-md text-[12.5px] leading-relaxed text-ink-faint">
        {t('当前知识节点暂无教学内容。你可以让超级导师根据知识树脉络与权威资料自动撰写系统化的教学内容。')}
      </p>
      {onGenerate && (
        <button
          type="button"
          onClick={onGenerate}
          className="mt-6 flex items-center gap-2 rounded-xl bg-seal px-4 py-2 text-[13px] font-medium text-white shadow-sm transition hover:bg-seal-deep cursor-pointer"
        >
          <Sparkles size={15} />
          <span>{t('生成教学文档')}</span>
        </button>
      )}
      {/* 美观的静态结构占位元素 */}
      <div
        className="mt-8 flex w-full max-w-md flex-col gap-3 rounded-xl border border-dashed border-line-strong/30 bg-paper/40 p-5 text-left"
        aria-hidden="true"
      >
        <div className="h-4 w-1/3 rounded bg-line-strong/20" />
        <div className="h-3 w-5/6 rounded bg-line-strong/10" />
        <div className="h-3 w-4/6 rounded bg-line-strong/10" />
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line-strong/20 bg-card/50 p-3.5">
          <div className="h-3.5 w-1/4 rounded bg-seal/20" />
          <div className="h-2.5 w-full rounded bg-line-strong/10" />
          <div className="h-2.5 w-4/5 rounded bg-line-strong/10" />
        </div>
      </div>
    </div>
  )
}

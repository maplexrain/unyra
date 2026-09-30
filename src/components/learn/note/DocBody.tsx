/**
 * 这个文件负责什么：正文那一块——滚动容器、正文本身（MarkdownView 渲染出来的 HTML）、
 * 正文还没来 / 笔记还空着时的两种占位，以及底部那行字数与选区提示。
 *
 * 它不碰任何状态：字号系数、正文 HTML、注解都从上层传进来（见 NodeNote）。
 * 选词菜单是浮在正文上的，但定位与开合都不在这里——它作为 overlay 插回原来那一层，
 * 免得把它挪出正文区之后 fixed 定位的夹取与滚动容器的关系变了。
 */
import type { CSSProperties, ReactNode, RefObject } from 'react'
import MarkdownView from '../../MarkdownView'
import WaveBars from '../../WaveBars'
import type { Annotation, DocKind } from '../../../learn/types'
import type { AnnotationActions } from '../../../lib/annotation'
import { copySelectionAsMarkdown } from '../../../lib/copySource'
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
  /** 正文字数（去掉空白）：页脚那行用 */
  wordCount: number
  /** 浮在正文这一层上的东西（选词菜单）：位置与开合由上层管，这里只负责插回原位 */
  overlay?: ReactNode
}

/** 正文区：从滚动容器到页脚那一行，整块都是它 */
export function DocBody({
  scrollRef,
  bodyRef,
  docScale,
  pending,
  kind,
  content,
  html,
  annotations,
  knownConceptKeys,
  annotationActions,
  wordCount,
  overlay,
}: Props) {
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      {/* 左侧留白给得多一点：标题定位栏就在旁边，正文（以及跳转高亮的底色）不贴过去。
          min-h-full + flex-col + 页脚 mt-auto：正文短时页脚被撑到底部，长时跟着正文走 */}
      <div className="doc-measure relative flex min-h-full flex-col pt-6 pl-[32px] pr-[22px]">
        {/* 正文还没来时的占位：说明在等什么，而不是留一片白 */}
        {pending && !content.trim() && <DocPending />}

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
          />
        </div>

        {overlay}

        {/*
          底部信息：字数与选区提示。
          要点是「始终在正文区底部」：
          - mt-auto 管正文短的时候，被上面的内容顶到底部；
          - sticky bottom-0 管正文长的时候，滚到哪儿它都贴在下沿，不会跟着内容跑到
            文档末尾去（那等于要滚到底才看得见）。
          贴底就会压住滚过去的正文，所以给一层半透明底 + 模糊，并用一道上边框把
          它和正文分开。高度按一行算：窄窗口下那行提示不该折成两行（折了会白占
          一行，还把这条栏撑高），所以单行 + 溢出省略。
          必须待在 min-h-full 这一层**里面**：摆到外面就成了滚动容器的兄弟节点，
          mt-auto 无处可推，整行会被顶到视口下一个屏幕，看起来就像「不见了」。
        */}
        <div className="sticky bottom-0 mt-auto flex items-center gap-3 border-t border-line bg-card/95 py-1.5 text-[11px] text-ink-faint backdrop-blur-sm">
          <span className="shrink-0">{t('{0} 字', wordCount)}</span>
          <span className="ml-auto min-w-0 truncate">
            {t('选中文字可「学习」（新建节点）、「了解」（AI 释义）、「注解」（自己记）或「询问」（提问）')}
          </span>
        </div>
      </div>
    </div>
  )
}

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

/**
 * 正文还没落地时的占位。
 *
 * 价值全在「说明在等什么」：节点建好到正文出现之间有十几秒到几十秒，这段时间
 * 文档区原本是一片纯白，用户只能猜是不是卡死。这里给出波浪 + 骨架，
 * 并把两条不同的等待说清楚——写描述和写正文是两件事，用户能看懂走到哪一步了。
 *
 * 骨架要铺满整个正文区：等待时整片区域都是「内容正在来的样子」，而不是顶上一条
 * 占位、下面一大片空白。为此行数给足并裁掉多余的，且**整块骨架脱离文档流**——
 * 只要它还占着高度，容器就会跟着长高，整块被顶到视口以外（页脚也跟着掉下去）。
 */

/** 骨架行的宽度循环：宽窄交替才像文字，全一样宽就成了表格 */
const SKELETON_WIDTHS = [100, 93, 78, 96, 62, 88, 71, 99, 84, 66]

/** 行数按「够铺满最高的窗口」给，多出来的被裁掉，因此不必去量容器高度 */
const SKELETON_ROWS = 48

function DocPending() {
  const label = t('超级导师正在准备这个节点…')
  const hint = t('先拟标题与描述，正文紧接着就写；等待期间可以在右侧继续追问。')
  return (
    // 不加边框与底色：它是「教学文档还没来」的骨架，属于正文区本身，
    // 不该看起来像一张浮在正文里的卡片
    <div className="moji-in-soft mb-6 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 text-[12.5px]">
        <WaveBars className="text-seal" />
        <span className="font-medium text-ink">{label}</span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">{hint}</p>
      <div className="relative mt-3 min-h-0 flex-1 overflow-hidden" aria-hidden="true">
        {/* 行高与行距按正文的实际行距给（15.5px × 1.8 ≈ 28px 一行）：
            太密就成了一片条纹，看不出是「一行行文字」 */}
        <div className="absolute inset-0 space-y-4">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <div
              key={i}
              className="moji-skeleton h-4"
              style={{
                width: `${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}%`,
                // 延迟按 5 拍循环，波峰一样是一波推着一波，不因为行多而变慢
                animationDelay: `${(i % 5) * 90}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

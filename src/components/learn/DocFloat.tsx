import { useEffect, useRef, useState } from 'react'
import { BookOpen, Eye, ListTree, Maximize2, Minimize2, SquareCode } from 'lucide-react'
import type { OutlineHandle } from '../../lib/outline'
import type { DocView } from '../../learn/types'
import { t } from '../../i18n'
import DocOutline from './DocOutline'

/**
 * 文档区**右上角**的悬浮组（横向一条）——**一格一套**。
 *
 * 它现在只剩**这份文档怎么读**（源码 / 预览）、**这份文档的大纲**（悬停弹出标题列表，
 * 见 DocOutline），外加一颗「回到节点文档」（当前页签是从教学文档岔出去的时候才出现）。
 *
 * **导出也搬走了**：它在资源管理器的右键菜单里（节点 / 笔记 / 超级文档 / 本地文件各有一项）。
 * 导出天生是「对着某一份东西」的动作，而侧栏本来就摆着全部文档——比在这一条浮层里留一颗
 * 按钮、再让用户猜「导的是哪一份」清楚得多（Ctrl+E 仍是同一件事的快捷键）。
 *
 * 从前这里还挂着「笔记 / 超级文档 / 学习状态 / 试卷」四颗按钮，各自向下展开一块 tip。
 * 那些东西如今都有了更合适的地方——**左侧资源管理器**：一个节点底下就挂着它的笔记、
 * 试卷（还能展开历次考试）与超级文档，右键可以直接新建、删除、定位；**学习状态**挂在
 * 节点的右键菜单里。悬浮组因此回到它本来的分寸：浮在正文上的一条**工具条**，
 * 只管「眼前这一份文档」。顺带没有外壳也说得通了：几颗图标本来就认得出来，
 * 底色只留给悬停那一下。
 */

/** 视图开关那两颗按钮的样式：它们是「当前用哪种视图」的状态，比圆按钮小一档 */
const VIEW_BTN =
  'flex h-7 w-7 items-center justify-center rounded-lg border transition disabled:opacity-35'

/** 「回到节点文档」那颗：一枚普通圆按钮（没有 tip，只有原生 title） */
const ICON_BTN =
  'relative flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-soft transition hover:bg-line/50 hover:text-ink'

interface Props {
  /** 这一格当前用哪种视图（源码 / 预览）与能不能预览（md / html 才行） */
  view: DocView
  previewable: boolean
  /** 预览不可用时的那句说明。「不能预览」有两种情形（文件类型不支持、笔记还是空的），得分开说 */
  previewHint?: string
  onSwitchView: (view: DocView) => void
  /**
   * 当前页签是不是「从教学文档岔出去的」（笔记 / 超级文档）：是才显示「返回节点文档」——
   * 本来就在教学文档上时，再给一颗「回去」只会占地方。
   */
  showBackToDoc: boolean
  /** 回到这个节点的教学文档 */
  onBackToDoc: () => void
  /**
   * 现在是不是纯净阅读模式（两侧栏、页签栏、顶栏都收着，只剩正文）。
   * 它决定最后那颗按钮画成「进入」还是「退出」。
   */
  pure: boolean
  /** 切换纯净阅读（与 F11 是同一个动作，见 lib/shortcuts 的 doc.zen） */
  onTogglePure: () => void
  /**
   * 眼前这份文档的大纲句柄槽（见 lib/outline 的 OutlineHandle）。
   *
   * 大纲由渲染组件算好放进槽（滚动高亮每跨一节都在变，不适合提为 state），
   * 悬停那一刻解引用来取。取不到（正文没有标题、或源码视图）时按钮不弹浮层。
   */
  outlineSlot?: { current: OutlineHandle | null }
}

/** 鼠标离开按钮/浮层后，再等这么久才算真离开：两段之间的空隙不该让浮层闪没 */
const LEAVE_GRACE_MS = 180
/** 退场动画的时长（与 motion.css 的 moji-tip-out 一致）：播完才卸载 */
const HIDE_MS = 150
/** 浮层开着时跟随「当前读到哪一节」的刷新节奏（activeIndex 变了才动） */
const FOLLOW_MS = 300

export default function DocFloat({
  view,
  previewable,
  previewHint,
  onSwitchView,
  showBackToDoc,
  onBackToDoc,
  pure,
  onTogglePure,
  outlineSlot,
}: Props) {
  /**
   * 浮层三态：closed（不挂载）→ open（展开）→ closing（退场动画中）→ closed。
   * 中间态是给退场动画留的：unmount 太快就什么都看不到，收回的那一帧必须真的播完。
   */
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed')
  /** 快照在打开那一刻取一次，开着的时候定时跟句柄对齐 */
  const [snap, setSnap] = useState<{ items: OutlineHandle['items']; activeIndex: number } | null>(null)
  const timers = useRef<{ leave?: number; hide?: number; follow?: number }>({})

  useEffect(
    () => () => {
      if (timers.current.leave !== undefined) window.clearTimeout(timers.current.leave)
      if (timers.current.hide !== undefined) window.clearTimeout(timers.current.hide)
      if (timers.current.follow !== undefined) window.clearInterval(timers.current.follow)
    },
    [],
  )

  /** 走退场：先播收回动画，播完才把浮层从 DOM 里摘掉 */
  const beginClose = () => {
    if (timers.current.hide !== undefined) return
    if (timers.current.follow !== undefined) window.clearInterval(timers.current.follow)
    timers.current.follow = undefined
    setPhase((p) => (p === 'closed' ? p : 'closing'))
    timers.current.hide = window.setTimeout(() => {
      timers.current.hide = undefined
      setPhase('closed')
      setSnap(null)
    }, HIDE_MS)
  }

  const openNow = () => {
    // 收回途中又移回来了：取消那趟退场，回到展开（动画类换回去，重新播一遍展开）
    if (timers.current.leave !== undefined) window.clearTimeout(timers.current.leave)
    if (timers.current.hide !== undefined) window.clearTimeout(timers.current.hide)
    timers.current.leave = undefined
    timers.current.hide = undefined
    const h = outlineSlot?.current ?? null
    if (!h || !h.items.length) return
    setSnap({ items: h.items, activeIndex: h.activeIndex })
    setPhase('open')
    if (timers.current.follow === undefined) {
      // 开着的时候正文可能还在滚：跟着句柄把「当前读到哪」刷进高亮
      timers.current.follow = window.setInterval(() => {
        const cur = outlineSlot?.current ?? null
        if (!cur || !cur.items.length) {
          beginClose()
          return
        }
        setSnap((prev) =>
          prev && prev.items === cur.items && prev.activeIndex === cur.activeIndex
            ? prev
            : { items: cur.items, activeIndex: cur.activeIndex },
        )
      }, FOLLOW_MS)
    }
  }

  const closeSoon = () => {
    if (timers.current.leave !== undefined) return
    timers.current.leave = window.setTimeout(() => {
      timers.current.leave = undefined
      beginClose()
    }, LEAVE_GRACE_MS)
  }

  return (
    <div className="no-print absolute right-3 top-2 z-20">
      <div className="flex flex-row items-center gap-1">
        {showBackToDoc && (
          <>
            <button type="button" title={t('回到这个节点的教学文档')} onClick={onBackToDoc} className={ICON_BTN}>
              <BookOpen size={15} />
            </button>
            <span aria-hidden="true" className="mx-0.5 h-4 w-px self-center bg-line-strong/70" />
          </>
        )}
        {/*
          标题大纲：悬停弹出一份 tip（见 DocOutline），列出当前 markdown 的标题，
          点一条跳到那一节。rel 包着按钮与浮层：从按钮移进浮层不算「离开」，
          从浮层出来才收（有 LEAVE_GRACE_MS 的宽限）。
        */}
        <div className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
          <button
            type="button"
            title={t('标题大纲：鼠标停留展开，点一条跳到对应标题')}
            aria-expanded={phase === 'open'}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-soft transition hover:bg-line/50 hover:text-ink"
          >
            <ListTree size={15} />
          </button>
          {phase !== 'closed' && snap && (
            <DocOutline
              items={snap.items}
              activeIndex={snap.activeIndex}
              closing={phase === 'closing'}
              onJump={(index) => outlineSlot?.current?.jump(index)}
              onDismiss={beginClose}
            />
          )}
        </div>

        {/*
          源码 / 预览**合成一颗**（用户定的）：这两件事本来就是同一个开关的两端
          （「这份文档现在怎么看」只有两种），摆两颗按钮等于把一对互斥状态画成两个动作，
          而真正会点的永远只有一颗——切到另一边。
          图标显示**现在在哪一边**，title 说明点下去会到哪一边。
          媒体预览（图片 / 音频 / 视频）没有源码可看：整颗不出现。
        */}
        {view !== 'media' && (
          <button
            type="button"
            title={
              view === 'source'
                ? previewable
                  ? t('预览：看渲染后的样子（现在是源码）')
                  : (previewHint ?? t('这份文件不能预览（只支持 Markdown 与 HTML），只能看源码'))
                : t('源码：直接编辑 Markdown / HTML（现在是预览）')
            }
            aria-pressed={view === 'preview'}
            disabled={view === 'source' && !previewable}
            onClick={() => onSwitchView(view === 'source' ? 'preview' : 'source')}
            className={
              VIEW_BTN + ' border-transparent text-ink-soft hover:bg-line/50 hover:text-ink'
            }
          >
            {view === 'source' ? <SquareCode size={15} /> : <Eye size={15} />}
          </button>
        )}

        {/*
          纯净阅读：把两侧栏、页签栏与顶栏一起收掉，只留正文（F11 / Esc 是同一件事，
          见 lib/shortcuts 的 doc.zen）。

          它排在这一条的**最右端**，与左边那几颗隔开一条竖线：前面几颗都是「这份文档怎么读」，
          这一颗管的是「整个界面怎么让位」——不是一类东西，不该混成一排认不出来。
          收到只剩正文之后，这一条浮在正文右上角，这颗按钮就是屏幕上唯一的出口
          （pure 时图标换成「收回来」，title 里写清 F11 / Esc 也能退）。
        */}
        <span aria-hidden="true" className="mx-0.5 h-4 w-px self-center bg-line-strong/70" />
        <button
          type="button"
          title={pure ? t('退出纯净阅读（F11 / Esc）') : t('纯净阅读：收起两侧栏、页签栏与顶栏，只留正文（F11）')}
          aria-pressed={pure}
          onClick={onTogglePure}
          /*
           * 收着的时候给它上一点底色：那时它是屏幕上唯一的控件，得让人一眼看见。
           * 整串类名分两套写、而不是在 ICON_BTN 后面追加——Tailwind 里同属性的工具类
           * 谁生效由生成顺序说了算（border-transparent 与 border-line-strong 是同一层），
           * 追加的那一串很可能被基类盖掉。
           */
          className={
            pure
              ? 'relative flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-line/50 text-ink transition'
              : ICON_BTN
          }
        >
          {pure ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
    </div>
  )
}

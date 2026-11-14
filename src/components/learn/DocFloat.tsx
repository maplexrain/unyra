import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Brain, Columns2, Eye, ListTree, Network, Pencil } from 'lucide-react'
import type { OutlineHandle } from '../../lib/outline'
import type { DocView, TabRef } from '../../learn/types'
import { t } from '../../i18n'
import { useVimEnabled } from '../../lib/vimSettings'
import { ensureVimConfigFile } from '../../lib/vimConfig'
import DocOutline from './DocOutline'
import DocRelations from './DocRelations'
import VimIcon from './VimIcon'
import VimFloatTip from './VimFloatTip'
import { toggleEditorPreview, subscribeEditorPreview } from './editor/previewBus'
import { loadMemoryMode, subscribeMemoryMode, toggleMemoryMode } from '../../lib/memoryMode'
import MemoryModeTip from './MemoryModeTip'
import type { NodeRelations, RelationItem } from './docRelations/computeRelations'

/**
 * 文档区左侧的悬浮工具条（垂直排列）——一格一套。
 *
 * 它锚定在**页签容器**上（GroupBody 的 relative 那一层），不属于编辑列：
 * 编辑列与预览列对调（:preview switch / 双击分割线）时它保持原位不动——
 * 它是**这一页的模式开关**（阅读 ↔ 编辑），不是编辑栏的一部分。
 *
 * 包含：阅读/编辑模式切换（同一枚页签就地切，图标反转显示目标动作）、
 * 分栏实时预览开关、Vim 模式卡片、关联节点、标题大纲（悬停向右弹出）。
 * 遵循严格直角规范（rounded-none）。
 */

/** 视图开关按钮样式：严格直角 */
const VIEW_BTN =
  'flex h-7 w-7 items-center justify-center rounded-none border transition disabled:opacity-35'

/** 普通图标按钮样式：严格直角 */
const ICON_BTN =
  'relative flex h-8 w-8 items-center justify-center rounded-none border border-transparent text-ink-soft transition hover:bg-line/50 hover:text-ink'

interface Props {
  /** 这一格当前用哪种视图（源码 / 预览）与能不能预览（md / html 才行） */
  view: DocView
  previewable: boolean
  /** 预览不可用时的那句说明。「不能预览」有两种情形（文件类型不支持、笔记还是空的），得分开说 */
  previewHint?: string
  /** 当前页签的分栏预览状态键（与 LiveSplitPreview 的 storageKey 同一口径，见 GroupBody） */
  previewKey?: string
  onSwitchView: (view: DocView) => void
  /**
   * 眼前这份文档的大纲句柄槽（见 lib/outline 的 OutlineHandle）。
   */
  outlineSlot?: { current: OutlineHandle | null }
  /** 打开 Vim 配置文件页签 */
  onOpenVimConfig?: (path: string) => void
  /** 记忆模式的文档键（教学文档才有）：按钮与 tip 都按它读写这份文档的状态 */
  memoryKey?: string
  /** 与当前节点关联的节点分类表（上级/下级/同级） */
  relations?: NodeRelations
  /** 点击打开关联节点 */
  onOpenRelation?: (ref: TabRef, item?: RelationItem) => void
}

/** 鼠标离开按钮/浮层后，再等这么久才算真离开：两段之间的空隙不该让浮层闪没 */
const LEAVE_GRACE_MS = 180
/** 退场动画的时长（与 motion.css 的 moji-tip-out 一致）：播完才卸载 */
const HIDE_MS = 150
/** 浮层开着时跟随「当前读到哪一节」的刷新节奏（activeIndex 变了才动） */
const FOLLOW_MS = 300

/**
 * 悬浮组右上角的文档统计（字数，源码模式还带保存状态）。
 * 工具条移到左侧垂直排列后，字数统计信息依旧保持在右上角（top-2.5 right-3）。
 * pointer-events-none：它是读数不是控件，不该抢正文上的选字与点击。
 */
export function DocStatChip({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      title={title}
      className="no-print pointer-events-none absolute right-3 top-2.5 z-10 flex items-center gap-1.5 rounded-none border border-line/60 bg-card/75 px-2 py-0.5 text-[11px] text-ink-faint shadow-xs backdrop-blur-xs select-none"
    >
      {children}
    </div>
  )
}

export default function DocFloat({
  view,
  previewable,
  previewHint,
  previewKey,
  onSwitchView,
  outlineSlot,
  relations,
  onOpenRelation,
  onOpenVimConfig,
  memoryKey,
}: Props) {
  /**
   * 浮层三态：closed（不挂载）→ open（展开）→ closing（退场动画中）→ closed。
   */
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed')
  /** 快照在打开那一刻取一次，开着的时候定时跟句柄对齐 */
  const [snap, setSnap] = useState<{ items: OutlineHandle['items']; activeIndex: number } | null>(null)
  const [vimEnabled, setVimEnabled] = useVimEnabled()
  const [vimTipOpen, setVimTipOpen] = useState(false)
  const vimLeaveTimer = useRef<number | undefined>(undefined)
  const timers = useRef<{ leave?: number; hide?: number; follow?: number }>({})
  const [relPhase, setRelPhase] = useState<'closed' | 'open' | 'closing'>('closed')
  const relTimers = useRef<{ leave?: number; hide?: number }>({})
  /** 记忆模式开没开（按钮的按下态）：按文档键订阅，tip 里改范围/换种子时按钮一起跟 */
  const [memOn, setMemOn] = useState(() => (memoryKey ? loadMemoryMode(memoryKey).on : false))
  const [memTipOpen, setMemTipOpen] = useState(false)
  const memLeaveTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!memoryKey) return
    setMemOn(loadMemoryMode(memoryKey).on)
    return subscribeMemoryMode((key, s) => {
      if (key === memoryKey) setMemOn(s.on)
    })
  }, [memoryKey])
  const [splitPreviewOpen, setSplitPreviewOpen] = useState(false)

  // 点名广播只认眼前这份文档的键：键随页签换，订阅跟着换（换键那一帧旧订阅已退，不会串）
  useEffect(() => {
    return subscribeEditorPreview((force, key) => {
      if (key !== undefined && key !== previewKey) return
      setSplitPreviewOpen((prev) => (force !== undefined ? force : !prev))
    })
  }, [previewKey])

  useEffect(
    () => () => {
      if (timers.current.leave !== undefined) window.clearTimeout(timers.current.leave)
      if (timers.current.hide !== undefined) window.clearTimeout(timers.current.hide)
      if (timers.current.follow !== undefined) window.clearInterval(timers.current.follow)
      if (relTimers.current.leave !== undefined) window.clearTimeout(relTimers.current.leave)
      if (relTimers.current.hide !== undefined) window.clearTimeout(relTimers.current.hide)
      if (memLeaveTimer.current !== undefined) window.clearTimeout(memLeaveTimer.current)
      if (vimLeaveTimer.current !== undefined) window.clearTimeout(vimLeaveTimer.current)
    },
    [],
  )

  const openVimTipNow = () => {
    if (vimLeaveTimer.current !== undefined) {
      window.clearTimeout(vimLeaveTimer.current)
      vimLeaveTimer.current = undefined
    }
    setVimTipOpen(true)
  }

  const closeVimTipSoon = () => {
    if (vimLeaveTimer.current !== undefined) return
    vimLeaveTimer.current = window.setTimeout(() => {
      vimLeaveTimer.current = undefined
      setVimTipOpen(false)
    }, LEAVE_GRACE_MS)
  }

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
    if (timers.current.leave !== undefined) window.clearTimeout(timers.current.leave)
    if (timers.current.hide !== undefined) window.clearTimeout(timers.current.hide)
    timers.current.leave = undefined
    timers.current.hide = undefined
    const h = outlineSlot?.current ?? null
    if (!h || !h.items.length) return
    setSnap({ items: h.items, activeIndex: h.activeIndex })
    setPhase('open')
    if (timers.current.follow === undefined) {
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

  const beginCloseRelations = () => {
    if (relTimers.current.hide !== undefined) return
    setRelPhase((p) => (p === 'closed' ? p : 'closing'))
    relTimers.current.hide = window.setTimeout(() => {
      relTimers.current.hide = undefined
      setRelPhase('closed')
    }, HIDE_MS)
  }

  const openRelationsNow = () => {
    if (relTimers.current.leave !== undefined) window.clearTimeout(relTimers.current.leave)
    if (relTimers.current.hide !== undefined) window.clearTimeout(relTimers.current.hide)
    relTimers.current.leave = undefined
    relTimers.current.hide = undefined
    setRelPhase('open')
  }

  const closeRelationsSoon = () => {
    if (relTimers.current.leave !== undefined) return
    relTimers.current.leave = window.setTimeout(() => {
      relTimers.current.leave = undefined
      beginCloseRelations()
    }, LEAVE_GRACE_MS)
  }

  const closeSoon = () => {
    if (timers.current.leave !== undefined) return
    timers.current.leave = window.setTimeout(() => {
      timers.current.leave = undefined
      beginClose()
    }, LEAVE_GRACE_MS)
  }

  return (
    <div className="no-print absolute left-3 top-2.5 z-20">
      <div className="flex flex-col items-center gap-1">
        {/*
          1. 阅读模式 / 编辑模式切换按钮（排在第一位）：
          同一枚页签就地切模式（不再开对偶页签）——编辑态显示 Eye（切去阅读），
          阅读态显示 Pencil（切去编辑）。媒体预览（图片 / 音频 / 视频 / PDF）
          没有模式可言，整颗不出现。
        */}
        {view !== 'media' && (
          <button
            type="button"
            title={
              view === 'source'
                ? previewable
                  ? t('切换到阅读模式')
                  : (previewHint ?? t('这份文件不能预览（只支持 Markdown 与 HTML），只能看源码'))
                : t('切换到编辑模式')
            }
            aria-pressed={view === 'source'}
            disabled={view === 'source' && !previewable}
            onClick={() => onSwitchView(view === 'source' ? 'preview' : 'source')}
            className={
              VIEW_BTN + ' border-transparent text-ink-soft hover:bg-line/50 hover:text-ink'
            }
          >
            {view === 'source' ? (
              <Eye size={15} className="transition-colors" />
            ) : (
              <Pencil size={15} className="transition-colors" />
            )}
          </button>
        )}

        {/*
          2. 常驻分栏对照预览按钮（用户指定常驻）：
          在可预览文档中常驻展示；阅读态下点击 = 切进编辑模式并展开分栏，编辑态下开/关分栏。
        */}
        {view !== 'media' && previewable && (
          <button
            type="button"
            title={
              splitPreviewOpen
                ? t('关闭分栏预览 (:preview)')
                : t('打开分栏实时预览 (:preview)')
            }
            aria-pressed={splitPreviewOpen}
            onClick={() => {
              if (view !== 'source') {
                onSwitchView('source')
                toggleEditorPreview(true, previewKey)
              } else {
                toggleEditorPreview(undefined, previewKey)
              }
            }}
            className={
              VIEW_BTN +
              ' transition-all ' +
              (splitPreviewOpen && view === 'source'
                ? 'border-seal/50 bg-seal/15 text-seal shadow-xs'
                : 'border-transparent text-ink-soft hover:bg-line/50 hover:text-ink')
            }
          >
            <Columns2 size={15} className="transition-colors" />
          </button>
        )}

        {/*
          Vim 模式卡片：鼠标经过弹出 tip，显示一键开关组件与配置文件 (.vimrc) 打开按钮。
          经典绿色斜方盾牌 Vim 徽标，辨识度高。
        */}
        {view === 'source' && (
          <div
            className="relative"
            onMouseEnter={openVimTipNow}
            onMouseLeave={closeVimTipSoon}
          >
            <button
              type="button"
              title={t('Vim 模式设置与配置')}
              aria-expanded={vimTipOpen}
              className={
                VIEW_BTN +
                ' transition-all ' +
                (vimEnabled
                  ? 'border-[#019833]/50 bg-[#019833]/15 text-[#019833] shadow-xs'
                  : 'border-transparent text-ink-soft opacity-60 hover:opacity-100 hover:bg-line/50 hover:text-ink')
              }
            >
              <VimIcon size={14} className="transition-transform group-hover:scale-105" />
            </button>

            {vimTipOpen && (
              <VimFloatTip
                enabled={vimEnabled}
                onToggle={() => setVimEnabled(!vimEnabled)}
                onOpenConfig={async () => {
                  const path = await ensureVimConfigFile()
                  if (path) {
                    onOpenVimConfig?.(path)
                    setVimTipOpen(false)
                  }
                }}
              />
            )}
          </div>
        )}

        
        {/*
          2. 关系按钮：排在源码 / 预览视图切换按钮下方。
          鼠标经过时弹出与当前节点相关的节点列表 tip，分类显示上级/下级/同级。
        */}
        {/*
          记忆模式（教学文档专属）：把正文里一部分块元素按持久化的随机种子盖上遮罩，
          悬停揭示——主动回忆的自测。按钮点击开/关，悬停弹 slider 调范围、换随机分布。
        */}
        {view === 'preview' && memoryKey && (
          <div
            className="relative"
            onMouseEnter={() => {
              if (memLeaveTimer.current !== undefined) {
                window.clearTimeout(memLeaveTimer.current)
                memLeaveTimer.current = undefined
              }
              setMemTipOpen(true)
            }}
            onMouseLeave={() => {
              if (memLeaveTimer.current !== undefined) return
              memLeaveTimer.current = window.setTimeout(() => {
                memLeaveTimer.current = undefined
                setMemTipOpen(false)
              }, LEAVE_GRACE_MS)
            }}
          >
            <button
              type="button"
              title={t('记忆模式：遮住部分内容自测回忆（悬停调范围、换随机分布）')}
              aria-pressed={memOn}
              onClick={() => toggleMemoryMode(memoryKey)}
              className={
                VIEW_BTN +
                ' transition-all ' +
                (memOn
                  ? 'border-seal/50 bg-seal/15 text-seal shadow-xs'
                  : 'border-transparent text-ink-soft opacity-60 hover:opacity-100 hover:bg-line/50 hover:text-ink')
              }
            >
              <Brain size={15} />
            </button>
            {memTipOpen && <MemoryModeTip docKey={memoryKey} state={loadMemoryMode(memoryKey)} />}
          </div>
        )}

        {relations && (
          <div className="relative" onMouseEnter={openRelationsNow} onMouseLeave={closeRelationsSoon}>
            <button
              type="button"
              title={t('关联节点：鼠标停留展开上级、下级与同级节点')}
              aria-expanded={relPhase === 'open'}
              className={ICON_BTN}
            >
              <Network size={15} className="transition-colors" />
            </button>
            {relPhase !== 'closed' && (
              <DocRelations
                relations={relations}
                closing={relPhase === 'closing'}
                onSelect={(item) => {
                  beginCloseRelations()
                  onOpenRelation?.(item.tabRef, item)
                }}
                onDismiss={beginCloseRelations}
              />
            )}
          </div>
        )}

        {/* 3. 标题大纲：树状图标，悬停向右弹出大纲列表卡片 */}
        {view === 'preview' && (
          <div className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
            <button
              type="button"
              title={t('标题大纲：鼠标停留展开，点一条跳到对应标题')}
              aria-expanded={phase === 'open'}
              className={ICON_BTN}
            >
              <ListTree size={15} className="transition-colors" />
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
        )}
      </div>
    </div>
  )
}

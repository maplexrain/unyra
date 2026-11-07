/**
 * 结构画布的卡片渲染：displayCards 逐张铺开——头部徽章行（高度必须等于 OUTLINE_HEAD，
 * 目标项圆点按它算）、大纲的目标项行（内联编辑 / 增删 / 菱形接口点）、文档摘要两行、
 * 空文档的「生成文档」、试卷的作答记录与开始考试、视频卡与文件卡的第二行、项目卡的
 * 路径行与懒加载目录树、挂件的生成按钮、普通连线把手与进线接口、卡外便签。
 * 视口外的卡只渲染轻量占位。纯展示件：逐项 props + 内联回调，状态全部由宿主持有。
 */

import { Fragment } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, File as FileIcon, Folder, FolderOpen, Pencil, X } from 'lucide-react'
import type { FileNodeKind, LearnStore } from '../../../learn/types'
import type { HeightOf } from '../../../learn/structure'
import { GRAPH_KIND_LABEL, cardWidthOf } from '../../../learn/structure'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import { outlineUuid } from '../../../learn/nodeKinds'
import { nodeById } from '../../../learn/graph'
import { t } from '../../../i18n'
import type { ChannelResult, MenuState } from './canvasTypes'
import { PROJ_PATH_ROW, PROJ_TREE_MAX_ROWS, PROJ_TREE_ROW, type ProjDirState, type ProjRow } from './canvasProjectTrees'
import {
  CARD_PAD_B,
  DOC_LINES,
  DOC_LINE_H,
  EDGE_ANCHOR_Y,
  KIND_BADGE,
  KIND_TONE,
  OUTLINE_HEAD,
  SLOT_ACCENT,
  SLOT_ROW,
  type CanvasEdge,
  type CardView,
} from './structureView'
import { FileCardRow, VideoCardRow, WheelStop } from './CanvasCardRows'

/** 正在内联编辑的大纲目标项（卡片 uuid、条目 slotKey、输入文本） */
export interface SlotEditState {
  uuid: string
  slotKey: string
  text: string
}

export interface CanvasCardsProps {
  displayCards: CardView[]
  selectedId: string | null
  multiIds: Set<string> | null
  hoverId: string | null
  height: HeightOf
  /** 拖动中的节点位置（只在本地，松手才写回坐标表）；整组拖时 moves 带上每一张的新位置 */
  draft: { id: string; x: number; y: number; moves?: Record<string, { x: number; y: number }> } | null
  /** 跳转后闪一下的那张卡（900ms 后清掉） */
  flashId: string | null
  /** 从列表拖出 / 连线时高亮**能当落点**的卡（null = 没有手势） */
  candidateIds: Set<string> | null
  /** 新手教学开着没有（教学假数据要整卡渲染） */
  tourOpen: boolean
  viewportBox: { left: number; top: number; right: number; bottom: number } | null
  /** 有上游边的卡 uuid 集合（未接入树的文档置灰提示） */
  upstreamEdgeSet: Set<string>
  /** exam / superdoc 的宿主文档 uuid 缓存（空白卡上生成按钮用） */
  leafOwnerCache: Map<string, string | null>
  byId: Map<string, CardView>
  edges: CanvasEdge[]
  store: LearnStore
  goalId: string
  docs: NodeDocActions
  exams: ExamActions
  editingSlot: SlotEditState | null
  setEditingSlot: Dispatch<SetStateAction<SlotEditState | null>>
  /** Escape 退出的那一拍先翻 true，onBlur 看到就不提交 */
  cancelledEditRef: RefObject<boolean>
  commitEditingSlot: (targetSlot: { uuid: string; slotKey: string; originalTitle: string }, newText: string) => void
  addingSlotUuid: string | null
  setAddingSlotUuid: Dispatch<SetStateAction<string | null>>
  addingSlotText: string
  setAddingSlotText: Dispatch<SetStateAction<string>>
  /** 同上：Escape 取消新建目标项 */
  cancelledAddRef: RefObject<boolean>
  commitAddingSlot: (outlineUuid: string, text: string) => void
  /** 指针停在某个目标项上：对应的那条子文档连线发光 */
  setHoverSlot: Dispatch<SetStateAction<{ parentId: string; key: string } | null>>
  setMenu: Dispatch<SetStateAction<MenuState | null>>
  setMenuText: Dispatch<SetStateAction<string>>
  onRenameOutlineEntry?: (outlineUuid: string, slotKey: string, nextTitle: string) => void
  onDeleteOutlineEntry?: (outlineUuid: string, slotKey: string) => void
  onGenerateOutline?: (docUuid: string) => void
  onGenerateDoc?: (nodeUuid: string, hint?: string) => void
  projExpanded: Record<string, Set<string>>
  projTrees: Record<string, Record<string, ProjDirState>>
  projTreeRows: (uuid: string) => ProjRow[]
  toggleProjRoot: (uuid: string) => void
  toggleProjDir: (uuid: string, dirPath: string) => void
  onOpenProjectFile?: (absPath: string) => void
  onUpdateVideoNode?: (nodeUuid: string, patch: { input?: string; title?: string; titleCustomized?: boolean }) => ChannelResult
  onGenerateVideoDoc?: (videoNodeUuid: string) => void
  onBindFile?: (nodeUuid: string, patch: { fileKind?: FileNodeKind; url?: string; title?: string; titleCustomized?: boolean }) => ChannelResult
  onToast?: (msg: string) => void
}

export function CanvasCards({
  displayCards,
  selectedId,
  multiIds,
  hoverId,
  height,
  draft,
  flashId,
  candidateIds,
  tourOpen,
  viewportBox,
  upstreamEdgeSet,
  leafOwnerCache,
  byId,
  edges,
  store,
  goalId,
  docs,
  exams,
  editingSlot,
  setEditingSlot,
  cancelledEditRef,
  commitEditingSlot,
  addingSlotUuid,
  setAddingSlotUuid,
  addingSlotText,
  setAddingSlotText,
  cancelledAddRef,
  commitAddingSlot,
  setHoverSlot,
  setMenu,
  setMenuText,
  onRenameOutlineEntry,
  onDeleteOutlineEntry,
  onGenerateOutline,
  onGenerateDoc,
  projExpanded,
  projTrees,
  projTreeRows,
  toggleProjRoot,
  toggleProjDir,
  onOpenProjectFile,
  onUpdateVideoNode,
  onGenerateVideoDoc,
  onBindFile,
  onToast,
}: CanvasCardsProps) {
  return (
    <>
        {displayCards.map((card) => {
          const selected = selectedId === card.uuid
          const multi = multiIds?.has(card.uuid) ?? false
          const isHovered = hoverId === card.uuid
          const h = height(card)
          const slots = card.slots ?? []
          const openable = card.kind !== 'outline'
          const lifted = !!draft && (draft.id === card.uuid || (draft.moves !== undefined && card.uuid in draft.moves))
          /*
           * 树的上游：线可能落在文档卡上，也可能落在大纲卡上（接大纲的嵌套子级）。
           * 没接进树的置灰提示（游离）；入口是根，天生没有上级。
           */
          // 性能优化：直接从 O(1) 索引查找
          const hasUpstream = upstreamEdgeSet.has(card.uuid) || upstreamEdgeSet.has(outlineUuid(card.uuid))
          const unassigned = card.kind === 'doc' && !card.entry && !hasUpstream
          // 入口就是根文档自己（一张图有且只有一个）：挂「入口」徽章
          const authoritativeRoot = card.entry === true
          // 性能优化：直接从预热缓存中获取
          const leafOwnerNodeId = leafOwnerCache.get(card.uuid) ?? null

          const isWebCard = card.kind === 'file' && (
            card.file?.fileKind === 'web' ||
            /^(https?:\/\/|\/\/)/i.test(card.file?.url ?? '') ||
            (card.file?.url ?? '').includes('://')
          )

          // 性能优化：视口包围盒裁剪，视口外的普通卡片仅渲染轻量占位容器，削减数千个复杂子 DOM
          const inView = !viewportBox || (
            card.x <= viewportBox.right &&
            card.x + cardWidthOf(card.kind) >= viewportBox.left &&
            card.y <= viewportBox.bottom &&
            card.y + h >= viewportBox.top
          )
          const mustRender = inView || selected || multi || isHovered || lifted || flashId === card.uuid || (candidateIds?.has(card.uuid) ?? false) || tourOpen
          return (
            <Fragment key={card.uuid}>
            <div
              data-node-id={card.uuid}
              {...(card.uuid === 'tour-mock-entry-doc'
                ? { 'data-tour-node': 'entry-doc' }
                : card.uuid === 'tour-mock-outline'
                  ? { 'data-tour-node': 'outline' }
                  : card.uuid === 'tour-mock-video'
                    ? { 'data-tour-node': 'video' }
                    : card.uuid === 'tour-mock-exam'
                      ? { 'data-tour-node': 'exam' }
                      : card.uuid === 'tour-mock-note'
                        ? { 'data-tour-node': 'note' }
                        : card.uuid === 'tour-mock-superdoc'
                          ? { 'data-tour-node': 'superdoc' }
                          : {})}
              className={`absolute flex flex-col border ${
                card.kind === 'file'
                  ? isWebCard
                    ? 'border-indigo-500/30 bg-indigo-500/[0.06]'
                    : 'border-blue-500/30 bg-blue-500/[0.06]'
                  : KIND_TONE[card.kind]
              } ${
                card.blank || unassigned ? 'border-dashed' : ''
              } ${unassigned ? 'opacity-70' : ''} ${
                selected || multi ? 'ring-2 ring-seal/60' : isHovered ? 'ring-1 ring-seal/35' : ''
              } ${lifted ? 'shadow-lg' : 'shadow-sm'} ${flashId === card.uuid ? 'moji-structure-flash' : ''} ${
                candidateIds?.has(card.uuid) ? 'moji-structure-candidate' : ''
              }`}
              style={{
                left: card.x,
                top: card.y,
                width: cardWidthOf(card.kind),
                minHeight: h,
                // 悬停不抢光标（箭头就好），拖起来才换成抓住的手——「可拖」由选中态与阴影说
                cursor: lifted ? 'grabbing' : undefined,
              }}
            >
              {mustRender ? (
                <>
              {/*
                标题行高度**必须**等于 OUTLINE_HEAD：目标项圆点的 y 是按这个常量算的
                （slotAnchorY = OUTLINE_HEAD + 行号 × 行高）。这里一旦改成 minHeight 或加
                padding，圆点就会和它那一行错开——真错过一次。
              */}
              <div className="flex shrink-0 items-center gap-1.5 px-3" style={{ height: OUTLINE_HEAD }} title={card.title}>
                <span
                  className={`shrink-0 px-1.5 py-[1px] text-[10px] font-semibold ${
                    card.kind === 'file'
                      ? isWebCard
                        ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                        : 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                      : KIND_BADGE[card.kind]
                  }`}
                >
                  {card.kind === 'file'
                    ? isWebCard
                      ? t('网页')
                      : t('文件')
                    : t(GRAPH_KIND_LABEL[card.kind])}
                </span>
                <span
                  {...(openable ? { 'data-open-title': card.uuid } : {})}
                  title={card.title}
                  className={`min-w-0 flex-1 truncate text-[11px] leading-tight tracking-tight font-medium text-ink ${
                    openable ? 'hover:text-seal hover:underline' : ''
                  }`}
                >
                  {card.title}
                </span>
                {authoritativeRoot && (
                  <span
                    title={t('入口：这门课从这份文档开始（右键其他无上级的文档可以换）')}
                    className="shrink-0 rounded bg-rose-500/15 px-1 py-[1px] text-[9px] font-semibold text-rose-600 dark:text-rose-300"
                  >
                    {t('入口')}
                  </span>
                )}
              </div>

              {card.kind === 'outline' && slots.length > 0 ? (
                /* 容器不带左右内边距：行自己带，圆点才能贴到卡片右边框上 */
                /* 不能加 overflow-hidden：圆点要伸出卡片右边框半颗，裁了连点击都收不到 */
                <div className="flex flex-col pb-2">
                  {slots.map((slot) => {
                    const isEditingThisSlot = editingSlot?.uuid === card.uuid && editingSlot?.slotKey === slot.key
                    return (
                      <div
                        key={slot.key}
                        data-slot-key={slot.key}
                        data-slot-parent={card.uuid}
                        title={isEditingThisSlot ? undefined : slot.childId ? `${slot.title} · ${t('跳到这个子文档')}` : `${slot.title} · ${t('生成一份空文档')}`}
                        onPointerEnter={() => !isEditingThisSlot && setHoverSlot({ parentId: card.uuid, key: slot.key })}
                        onPointerLeave={() => setHoverSlot(null)}
                        className={`group/slot relative flex items-center gap-1.5 pr-6 pl-2 ${
                          isEditingThisSlot ? 'bg-seal/[0.06]' : 'cursor-pointer hover:bg-seal/[0.08]'
                        }`}
                        style={{ height: SLOT_ROW }}
                      >
                        <span className="h-2 w-2 shrink-0" />
                        {isEditingThisSlot ? (
                          <div
                            className="flex min-w-0 flex-1 items-center"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              autoFocus
                              value={editingSlot.text}
                              onChange={(e) => setEditingSlot({ ...editingSlot, text: e.target.value.replace(/[\r\n]/g, '') })}
                              onFocus={(e) => e.target.select()}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  commitEditingSlot({ uuid: card.uuid, slotKey: slot.key, originalTitle: slot.title }, editingSlot.text)
                                } else if (e.key === 'Escape') {
                                  e.preventDefault()
                                  cancelledEditRef.current = true
                                  setEditingSlot(null)
                                }
                              }}
                              onBlur={() => {
                                if (cancelledEditRef.current) {
                                  cancelledEditRef.current = false
                                  return
                                }
                                commitEditingSlot({ uuid: card.uuid, slotKey: slot.key, originalTitle: slot.title }, editingSlot.text)
                              }}
                              className="min-w-0 flex-1 rounded border border-seal/50 bg-paper px-1.5 py-0 text-[11.5px] leading-[18px] text-ink outline-none focus:border-seal focus:ring-1 focus:ring-seal/30 dark:bg-card"
                            />
                          </div>
                        ) : (
                          <span
                            title={slot.title}
                            className="min-w-0 flex-1 truncate text-[11.5px]"
                            style={{ color: slot.childId ? SLOT_ACCENT : undefined, opacity: slot.childId ? 1 : 0.55 }}
                            onDoubleClick={(e) => {
                              if (onRenameOutlineEntry) {
                                e.stopPropagation()
                                setEditingSlot({ uuid: card.uuid, slotKey: slot.key, text: slot.title })
                                setAddingSlotUuid(null)
                                setMenu(null)
                              }
                            }}
                          >
                            {slot.title}
                          </span>
                        )}
                        {onRenameOutlineEntry && !isEditingThisSlot && (
                          <button
                            type="button"
                            data-rename-slot={slot.key}
                            data-rename-slot-parent={card.uuid}
                            title={t('重命名目标项「{0}」', slot.title)}
                            className="z-10 shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:bg-seal/15 hover:text-seal group-hover/slot:opacity-100"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingSlot({ uuid: card.uuid, slotKey: slot.key, text: slot.title })
                              setAddingSlotUuid(null)
                              setMenu(null)
                            }}
                          >
                            <Pencil size={11} strokeWidth={2.2} />
                          </button>
                        )}
                        {onDeleteOutlineEntry && !isEditingThisSlot && (
                          <button
                            type="button"
                            data-delete-slot={slot.key}
                            data-delete-slot-parent={card.uuid}
                            title={t('删除目标项「{0}」', slot.title)}
                            className="z-10 shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:bg-rose-500/15 hover:text-rose-500 group-hover/slot:opacity-100"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              onDeleteOutlineEntry(card.uuid, slot.key)
                            }}
                          >
                            <X size={11} strokeWidth={2.2} />
                          </button>
                        )}
                        {/*
                          接口点：**菱形**（旋转 45° 的小方块）——圆形留给普通连线把手，
                          一眼分得清「这是在认领某个接口」。认领了=实心，空着=空心。
                          位置规矩不变：放在这一行里面（垂直居中 flex 保证），圆心压在
                          1px 边框的中线上（right: -0.5px 再平移半颗）。
                        */}
                        <span
                          data-slot-dot={slot.key}
                          data-slot-dot-parent={card.uuid}
                          title={slot.childId ? t('已经挂上：拖出去可以换一份') : t('从接口拖出去挂一份文档或子大纲（会认领这条目标项）')}
                          className="absolute top-1/2 -right-[0.5px] h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rotate-45 cursor-crosshair rounded-[2px] border-2"
                          style={{
                            borderColor: SLOT_ACCENT,
                            background: slot.childId ? SLOT_ACCENT : 'var(--color-card, #fff)',
                          }}
                        />
                      </div>
                    )
                  })}
                  {/* 手动加一条目标项：这是大纲内容，走大纲节点的 editContent */}
                  {addingSlotUuid === card.uuid ? (
                    <div
                      className="flex items-center gap-1.5 pr-3 pl-2"
                      style={{ height: SLOT_ROW }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-[11px] text-seal">＋</span>
                      <input
                        type="text"
                        autoFocus
                        placeholder={t('新目标项标题...')}
                        value={addingSlotText}
                        onChange={(e) => setAddingSlotText(e.target.value.replace(/[\r\n]/g, ''))}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitAddingSlot(card.uuid, addingSlotText)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelledAddRef.current = true
                            setAddingSlotUuid(null)
                            setAddingSlotText('')
                          }
                        }}
                        onBlur={() => {
                          if (cancelledAddRef.current) {
                            cancelledAddRef.current = false
                            return
                          }
                          commitAddingSlot(card.uuid, addingSlotText)
                        }}
                        className="min-w-0 flex-1 rounded border border-seal/50 bg-paper px-1.5 py-0 text-[11px] leading-[18px] text-ink outline-none focus:border-seal focus:ring-1 focus:ring-seal/30 dark:bg-card"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-add-slot={card.uuid}
                      title={t('给这份大纲加一条目标项')}
                      className="flex w-full cursor-pointer items-center gap-1.5 pr-3 pl-2 text-left text-[11px] text-ink-faint hover:bg-seal/[0.08] hover:text-seal"
                      style={{ height: SLOT_ROW }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        setAddingSlotUuid(card.uuid)
                        setAddingSlotText('')
                        setEditingSlot(null)
                        setMenu(null)
                      }}
                    >
                      ＋ {t('添加目标项')}
                    </button>
                  )}
                </div>
              ) : card.kind === 'outline' && slots.length === 0 ? (
                /*
                  空大纲卡的「生成大纲」与手动添加目标项：
                  支持 Agent 自动规划，亦支持用户手动创建第一项目标
                */
                <div className="flex flex-col gap-1 px-3 pb-2">
                  <div className="flex h-6 items-center justify-between gap-2">
                    <span title={card.subtitle} className="min-w-0 flex-1 truncate text-[11px] text-ink-soft">{card.subtitle}</span>
                    <button
                      type="button"
                      title={card.free ? t('读它认领的目标项与上级上下文，规划这一层怎么拆') : t('读宿主文档，把「先要学会什么」铺成目标项')}
                      className="shrink-0 bg-seal/15 px-2 py-0.5 text-[11px] text-seal-deep hover:bg-seal/25"
                      onClick={() => {
                        if (card.uuid) onGenerateOutline?.(card.uuid)
                      }}
                    >
                      {t('生成总览')}
                    </button>
                  </div>
                  {addingSlotUuid === card.uuid ? (
                    <div
                      className="flex items-center gap-1.5"
                      style={{ height: SLOT_ROW }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-[11px] text-seal">＋</span>
                      <input
                        type="text"
                        autoFocus
                        placeholder={t('新目标项标题...')}
                        value={addingSlotText}
                        onChange={(e) => setAddingSlotText(e.target.value.replace(/[\r\n]/g, ''))}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitAddingSlot(card.uuid, addingSlotText)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelledAddRef.current = true
                            setAddingSlotUuid(null)
                            setAddingSlotText('')
                          }
                        }}
                        onBlur={() => {
                          if (cancelledAddRef.current) {
                            cancelledAddRef.current = false
                            return
                          }
                          commitAddingSlot(card.uuid, addingSlotText)
                        }}
                        className="min-w-0 flex-1 rounded border border-seal/50 bg-paper px-1.5 py-0 text-[11px] leading-[18px] text-ink outline-none focus:border-seal focus:ring-1 focus:ring-seal/30 dark:bg-card"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-add-slot={card.uuid}
                      title={t('给这份大纲加一条目标项')}
                      className="flex w-full cursor-pointer items-center gap-1.5 text-left text-[11px] text-ink-faint hover:bg-seal/[0.08] hover:text-seal"
                      style={{ height: SLOT_ROW }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        setAddingSlotUuid(card.uuid)
                        setAddingSlotText('')
                        setEditingSlot(null)
                        setMenu(null)
                      }}
                    >
                      ＋ {t('添加目标项')}
                    </button>
                  )}
                </div>
              ) : card.kind === 'doc' && card.excerpt ? (
                /*
                  有正文：**正好两行**摘要。
                  外层只负责裁：高度就是两行的行高之和、**不带内边距**（溢出是在 padding box
                  上裁的，留了 pb 就等于在第三行上开了一条 8px 的窗口，让它探出来半截）。
                  内层留着 line-clamp-2 只为一件事：让第二行末尾出现省略号。
                */
                <div
                  className="overflow-hidden px-3"
                  style={{ height: DOC_LINES * DOC_LINE_H, marginBottom: CARD_PAD_B }}
                >
                  <div className="line-clamp-2 text-[11px] text-ink-soft" style={{ lineHeight: `${DOC_LINE_H}px` }}>
                    {card.excerpt}
                  </div>
                </div>
              ) : card.kind === 'doc' && card.blank ? (
                /*
                  空文档：给「生成文档」。实体已就位（点目标项那一刻建的），
                  点击把「父大纲 + 所占目标项」作为意图一并交给 agent 的工作流。
                */
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span className="text-[11px] text-ink-faint">{t('还没有正文')}</span>
                  <button
                    type="button"
                    className="bg-seal/15 px-2 py-0.5 text-[11px] text-seal-deep hover:bg-seal/25"
                    onClick={() => {
                      // 意图：它挂在哪份大纲的哪条目标项下（按 key 对上号的那条）——树边可能落在它的大纲卡上（嵌套接入）
                      const face = byId.has(outlineUuid(card.uuid)) ? outlineUuid(card.uuid) : card.uuid
                      const upstream = edges.find((e) => e.to === face)
                      const upstreamCard = upstream ? byId.get(upstream.from) : undefined
                      const slotTitle = upstreamCard?.slots?.find((s) => s.childId === face)?.title
                      const hint =
                        upstreamCard && slotTitle
                          ? `【本轮是空文档填充】文档节点已就位（uuid ${card.uuid}）：教学文档直接写进它（api.node.get 后 editContent），不要创建任何新节点、不要拆下一层大纲。它的定位：大纲「${upstreamCard.title}」里「${slotTitle}」这条目标项的落地文档——正文围绕这条目标项展开，范围与同纲其他目标项错开。`
                          : undefined
                      onGenerateDoc?.(card.uuid, hint)
                    }}
                  >
                    {t('生成文档')}
                  </button>
                </div>
              ) : card.kind === 'exam' && (card.attempts?.length ?? 0) > 0 ? (
                /*
                  试卷的考试记录：一行一次作答，顶部配有「开始考试」按钮；
                  必须是真按钮：画布容器在 pointerdown 上捕获指针，非白名单元素的 click 会被吞掉。
                */
                <div className="flex flex-col pb-2">
                  <div className="flex items-center justify-between px-3 pb-1 pt-0.5 border-b border-line/40">
                    <span className="text-[10px] text-ink-faint">{t('作答记录 ({0})', card.attempts!.length)}</span>
                    <button
                      type="button"
                      title={t('开始考试（打开独立考试窗口）')}
                      onClick={() => {
                        const exam = store.exams.find((e) => e.id === card.uuid)
                        if (exam && !nodeById(store, exam.nodeId)) {
                          onToast?.(t('这份试卷还没绑到文档上：拖线连到某张文档卡之后就能开考'))
                          return
                        }
                        if (exam) exams.onStart(exam.nodeId, exam.id)
                      }}
                      className="rounded bg-seal/15 px-2 py-0.5 text-[10.5px] font-semibold text-seal-deep hover:bg-seal/25 transition cursor-pointer"
                    >
                      {t('开始考试')}
                    </button>
                  </div>
                  {card.attempts!.map((row) => (
                    <button
                      key={row.n}
                      type="button"
                      title={t('打开这一次考试的记录（卷子 + 作答 + 判分 + 错题讲解）')}
                      onClick={() => {
                        const exam = store.exams.find((e) => e.id === card.uuid)
                        if (exam) exams.onOpenRecord(exam.nodeId, exam.id, row.attemptId)
                      }}
                      className="flex w-full cursor-pointer items-center gap-1.5 px-3 text-left text-[11px] text-ink-soft hover:bg-seal/[0.08]"
                      style={{ height: SLOT_ROW }}
                    >
                      <span className="shrink-0 text-ink-faint">第 {row.n} 次</span>
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    </button>
                  ))}
                </div>
              ) : card.kind === 'exam' && !card.blank ? (
                /*
                  有内容的试卷（还没有作答记录）：显示考试按钮
                */
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span title={card.subtitle} className="min-w-0 flex-1 truncate text-[11px] text-ink-soft">{card.subtitle}</span>
                  <button
                    type="button"
                    title={t('开始考试（打开独立考试窗口）')}
                    className="shrink-0 rounded bg-seal/15 px-2.5 py-0.5 text-[11px] font-semibold text-seal-deep hover:bg-seal/25 transition cursor-pointer"
                    onClick={() => {
                      const exam = store.exams.find((e) => e.id === card.uuid)
                      if (exam && !nodeById(store, exam.nodeId)) {
                        onToast?.(t('这份试卷还没绑到文档上：拖线连到某张文档卡之后就能开考'))
                        return
                      }
                      if (exam) exams.onStart(exam.nodeId, exam.id)
                    }}
                  >
                    {t('开始考试')}
                  </button>
                </div>
              ) : card.kind === 'video' ? (
                /*
                  视频卡：两行结构。
                  第一行徽章 + 标题，第二行视频唯一标识输入框（URL/BV号）。
                  点击标题打开视频 Tab，确定为视频资源后，第二行标识输入框固化（只读展示，不再提供修改换绑等操作）。
                */
                <VideoCardRow
                  card={card}
                  store={store}
                  goalId={goalId}
                  onUpdateVideoNode={onUpdateVideoNode}
                  onGenerateVideoDoc={onGenerateVideoDoc}
                />
              ) : card.kind === 'file' ? (
                /*
                  文件卡：两行结构。
                  第一行 title，第二行响应式输入框（支持文件/网页响应式判断，无提交按钮），
                  内部右侧带选择本地文件按钮（先上传到 files/ 并注册清单，含 SHA-256 去重，然后引用）。
                  引用文件或网页后若 title 未手动命名则自动填充文件名或网页实际 title。
                */
                <FileCardRow
                  card={card}
                  store={store}
                  goalId={goalId}
                  onBindFile={onBindFile}
                  onToast={onToast}
                />
              ) : card.kind === 'project' ? (
                /*
                  项目卡：路径行（拼法徽标 + 路径 + 展开钮）+ 懒加载的目录树。
                  必须是真按钮：画布容器在 pointerdown 上捕获指针，非白名单元素的 click 会被吞掉。
                  目录树状态（展开/已加载数据）是组件自己的，不进派生——高度在 height 包装里叠加；
                  树容器是 WheelStop：内容自己滚，滚轮不许冒泡到画布的相机。
                */
                <div className="flex min-h-0 flex-1 flex-col pb-2">
                  {card.project?.path ? (
                    <>
                      <div className="flex items-center gap-1.5 px-3" style={{ height: PROJ_PATH_ROW }}>
                        <button
                          type="button"
                          title={t('展开 / 收起这个项目的目录')}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-teal-700 hover:bg-teal-500/15 dark:text-teal-300"
                          onClick={() => toggleProjRoot(card.uuid)}
                        >
                          {projExpanded[card.uuid]?.has('') ? (
                            <ChevronDown size={13} className="shrink-0" />
                          ) : (
                            <ChevronRight size={13} className="shrink-0" />
                          )}
                        </button>
                        <span
                          className="shrink-0 rounded bg-teal-500/15 px-1 py-[1px] text-[9px] font-semibold text-teal-700 dark:text-teal-300"
                          title={card.project.resolved ? t('解析到的真实路径') + '\n' + card.project.resolved : t('路径此刻解析不出（相对路径越出了用户目录，或数据根未就绪）')}
                        >
                          {card.project.pathKind === 'relative' ? t('相对') : t('绝对')}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-[11px] text-ink-soft"
                          title={card.project.resolved ? card.project.resolved : card.project.path}
                        >
                          {card.project.path}
                        </span>
                        <button
                          type="button"
                          title={t('修改这条声明（路径或拼法）')}
                          className="shrink-0 rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-ink-soft hover:bg-line/90 transition cursor-pointer"
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect()
                            setMenuText(card.project?.path ?? '')
                            setMenu({
                              x: Math.min(r.right, window.innerWidth - 300),
                              y: Math.min(r.bottom + 6, window.innerHeight - 200),
                              uuid: card.uuid,
                              mode: 'projectPath',
                            })
                          }}
                        >
                          {t('改路径')}
                        </button>
                      </div>
                      {projExpanded[card.uuid]?.has('') && (
                        <WheelStop
                          className="mx-2 overflow-y-auto rounded-md border border-line/70 bg-paper/40"
                          style={{ maxHeight: PROJ_TREE_MAX_ROWS * PROJ_TREE_ROW }}
                        >
                          {(() => {
                            const tree = projTrees[card.uuid]?.['']
                            if (tree?.loading) return <div className="px-3 py-1.5 text-[11px] text-ink-faint">{t('读取中…')}</div>
                            if (tree?.error) return <div className="px-3 py-1.5 text-[11px] text-seal-deep" title={tree.error}>{tree.error}</div>
                            const rows = projTreeRows(card.uuid)
                            if (!rows.length) return <div className="px-3 py-1.5 text-[11px] text-ink-faint">{t('（空目录）')}</div>
                            return (
                              <div className="flex flex-col py-0.5">
                                {rows.map((row) => (
                                  <button
                                    key={row.path}
                                    type="button"
                                    title={row.isDirectory ? row.path : t('在新页签打开这个文件')}
                                    className={
                                      'flex w-full cursor-pointer items-center gap-1 text-left text-[11px] hover:bg-teal-500/10 ' +
                                      (row.isDirectory ? 'text-ink' : 'text-ink-soft hover:text-seal')
                                    }
                                    style={{ height: PROJ_TREE_ROW, paddingLeft: 10 + row.depth * 12 }}
                                    onClick={() => {
                                      if (row.isDirectory) toggleProjDir(card.uuid, row.path)
                                      else if (card.project?.resolved && onOpenProjectFile) {
                                        onOpenProjectFile(card.project.resolved.replace(/[\\/]+$/, '') + '/' + row.path)
                                      }
                                    }}
                                  >
                                    {row.isDirectory ? (
                                      projExpanded[card.uuid]?.has(row.path) ? (
                                        <FolderOpen size={11} className="shrink-0 text-teal-600 dark:text-teal-400" />
                                      ) : (
                                        <Folder size={11} className="shrink-0 text-teal-600 dark:text-teal-400" />
                                      )
                                    ) : (
                                      <FileIcon size={11} className="shrink-0 text-ink-faint" />
                                    )}
                                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                                    {!row.isDirectory && <ExternalLink size={9} className="shrink-0 text-ink-faint/60" />}
                                  </button>
                                ))}
                              </div>
                            )
                          })()}
                        </WheelStop>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center justify-between gap-2 px-3 pb-2">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">{card.subtitle}</span>
                      <button
                        type="button"
                        title={t('声明这条路径（相对目标根目录或电脑绝对路径）')}
                        className="shrink-0 rounded bg-teal-500/15 px-2 py-0.5 text-[11px] font-medium text-teal-700 hover:bg-teal-500/25 transition cursor-pointer dark:text-teal-300"
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect()
                          setMenuText('')
                          setMenu({
                            x: Math.min(r.right, window.innerWidth - 300),
                            y: Math.min(r.bottom + 6, window.innerHeight - 200),
                            uuid: card.uuid,
                            mode: 'projectPath',
                          })
                        }}
                      >
                        {t('设置路径')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (card.kind === 'exam' || card.kind === 'superdoc') && card.blank && leafOwnerNodeId ? (
                /*
                  还没生成内容的试卷 / 超级文档：给一颗「生成」——出卷会先问类型与难度，
                  超级实验室会先问想做什么实验。**已经生成好的不再显示**（subtitle 就是内容在那里）。
                */
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span title={card.subtitle} className="min-w-0 flex-1 truncate text-[11px] text-ink-soft">{card.subtitle}</span>
                  <button
                    type="button"
                    className="shrink-0 bg-seal/15 px-2 py-0.5 text-[11px] text-seal-deep hover:bg-seal/25"
                    onClick={() =>
                      card.kind === 'exam'
                        ? docs.onNewExam(leafOwnerNodeId)
                        : docs.onNewSuperDoc(leafOwnerNodeId, card.title)
                    }
                  >
                    {card.kind === 'exam' ? t('生成试卷') : t('生成超级文档')}
                  </button>
                </div>
              ) : (
                <div title={card.subtitle} className="truncate px-3 pb-2 text-[11px] text-ink-soft">{card.subtitle}</div>
              )}

              {/*
                普通连线把手：**圆形**实心印章色、卡色描边、不透明——与目标项的菱形接口点
                区分开（圆=普通连接不带认领，菱=认领某个接口）。圆心压在 1px 边框的
                **中线**上：绝对定位的参照是 padding box，边框中线在参照缘外 0.5px。
                高度与连线锚点同一个值。
                出线把手（右）只长在 doc 上：大纲的出线全走目标项的菱形口（从口上拖出去
                才会认领），挂件与入口没有出线。
              */}
              {(card.kind === 'doc' || card.kind === 'video' || card.kind === 'exam' || card.kind === 'superdoc' || card.kind === 'file' || card.kind === 'note') && (
                <div
                  data-link-handle={card.uuid}
                  title={
                    card.kind === 'note'
                      ? t('拖出去连到文件节点')
                      : card.kind === 'exam' || card.kind === 'superdoc'
                        ? t('拖出去连到笔记或文件节点')
                        : card.kind === 'file'
                          ? t('拖出去连到下级节点')
                          : t('拖出去连到另一个节点')
                  }
                  className="absolute -right-[7.5px] h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-card bg-seal"
                  style={{ top: EDGE_ANCHOR_Y }}
                />
              )}
              {/* 进线接口（左）：实心、不透明。入口不画；视频卡为顶层资源无上游，不该有进线点 */}
              {card.kind !== 'entry' && !card.entry && (
                <div
                  className="pointer-events-none absolute -left-[7.5px] h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-card bg-seal"
                  style={{ top: EDGE_ANCHOR_Y }}
                />
              )}
                </>
              ) : (
                <div title={card.title} className="flex h-full w-full items-center justify-center text-[11px] text-ink-faint/45 select-none font-medium px-2 truncate">
                  {card.title}
                </div>
              )}
            </div>
            {/*
              注释：**贴在卡片外面**、跟着节点走的一条便签。
              不塞进卡片里——它会撑高卡片、把连线的锚点和自动排列都带偏；
              挂在外面之后，它只是一个跟着坐标走的标签，节点怎么长都不影响。
            */}
            {card.note && (
              <div
                className="absolute max-w-[260px] text-[10.5px] leading-snug text-ink-soft"
                style={{ left: card.x, top: card.y + h + 6, width: cardWidthOf(card.kind) }}
                title={card.note}
              >
                {card.note}
              </div>
            )}
            </Fragment>
          )
        })}
    </>
  )
}

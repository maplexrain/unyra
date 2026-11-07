/**
 * 结构画布的「画布外框」渲染件： KindIcon（palette 行的自绘类型图标）、
 * ControlButton（右下角工具组的图标按钮）、以及工具组 / 节点列表 / 垃圾桶 /
 * 拖拽影子这四块悬浮 UI。全部是展示件：逐项 props + 内联回调，不带自己的状态。
 */

import type { RefObject } from 'react'
import { FolderTree, Trash2 } from 'lucide-react'
import type { StructureMap } from '../../../learn/structure'
import {
  boundsOf,
  clampZoom,
  CARD_H,
  EDGE_STYLES,
  GRAPH_KIND_LABEL,
  cardWidthOf,
  type EdgeStyle,
} from '../../../learn/structure'
import type { GNodeKind } from '../../../learn/nodeKinds'
import { t } from '../../../i18n'
import { ICON_STROKE, PALETTE } from './canvasTypes'
import { KIND_BADGE } from './structureView'

/**
 * palette 行的图标：全部 24×24、描边 2、圆角端点——与 lucide 同一套笔画语言
 * （自绘图标纪律：比例先对齐成熟图形语言，不自造异形字）。图形口径：
 * 文档=带折角与行线的纸、大纲=圆点列表、笔记=折角便签、试卷=带勾的夹板、
 * 超级文档=闪光。
 */
export function KindIcon({ kind }: { kind: GNodeKind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (kind === 'doc') {
    return (
      <svg {...common}>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M10 9H8" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </svg>
    )
  }
  if (kind === 'outline') {
    return (
      <svg {...common}>
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
        <path d="M8 5h13" />
        <path d="M8 12h13" />
        <path d="M8 19h13" />
      </svg>
    )
  }
  if (kind === 'note') {
    return (
      <svg {...common}>
        <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2Z" />
        <path d="M15 21v-4a2 2 0 0 1 2-2h4" />
      </svg>
    )
  }
  if (kind === 'video') {
    // monitor-play 的同款笔画：屏幕 + 居中播放三角 + 底座（比例对齐 lucide，不自造异形）
    return (
      <svg {...common}>
        <path d="M10 7.5v9l7-4.5Z" />
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </svg>
    )
  }
  if (kind === 'project') {
    // 文件夹 + 内部两行缩进条目：一眼是「一个目录」（比例对齐 lucide，不自造异形）
    return (
      <svg {...common}>
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        <path d="M10 12h6" />
        <path d="M10 16h4" />
      </svg>
    )
  }
  if (kind === 'exam') {
    return (
      <svg {...common}>
        <rect width="8" height="4" x="8" y="2" rx="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    )
  }
  if (kind === 'file') {
    return (
      <svg {...common}>
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L13.663 8.5a2 2 0 0 0 1.401 1.398l6.135 1.581a.5.5 0 0 1 0 .964L13.5 14.063a2 2 0 0 0-1.4 1.402l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </svg>
  )
}

/**
 * 右下角工具组的图标按钮：文字说明只住在悬停 tip 里，平时零占位。
 * tip 从按钮**左侧**探出——工具组贴着画布右下角，右边没有地方。
 */
export function ControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group/btn relative flex h-6 w-6 items-center justify-center rounded transition hover:bg-line/60 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
      <span className="pointer-events-none absolute right-full top-1/2 z-30 mr-1.5 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-card px-1.5 py-0.5 text-[11px] text-ink-soft opacity-0 shadow-sm transition group-hover/btn:opacity-100">
        {label}
      </span>
    </button>
  )
}


/** 缩放读数：画布右下角工具组里的百分比 */
export function CanvasControls({
  camera,
  cameraRef,
  setCameraSync,
  cards,
  height,
  view,
  edgeStyle,
  saved,
  onChange,
  canUndo,
  undo,
  fit,
  autoArrange,
  onToggleViewMode,
  onOpenTour,
}: {
  camera: { x: number; y: number; zoom: number }
  cameraRef: RefObject<{ x: number; y: number; zoom: number }>
  setCameraSync: (next: { x: number; y: number; zoom: number }) => void
  cards: Array<{ uuid: string; kind: GNodeKind; x: number; y: number }>
  height: (c: { uuid: string; kind: GNodeKind }) => number
  view: { width: number; height: number }
  edgeStyle: EdgeStyle
  saved: StructureMap | undefined
  onChange: (next: StructureMap) => void
  canUndo: boolean
  undo: () => void
  fit: () => void
  autoArrange: () => void
  onToggleViewMode?: () => void
  onOpenTour: () => void
}) {
  const zoomPct = Math.round(camera.zoom * 100)
  return (
    <div
      data-tour="controls"
      className="absolute right-4 bottom-4 z-20 flex items-center gap-0.5 rounded-lg border border-line bg-card/85 px-1.5 py-1 text-[11px] text-ink-soft backdrop-blur"
    >
      <ControlButton
        label={t('缩小')}
        onClick={() => {
          const cam = cameraRef.current
          const next = clampZoom(cam.zoom - 0.15, boundsOf(cards, height), view)
          if (next !== cam.zoom) setCameraSync({ ...cam, zoom: next })
        }}
      >
        <svg {...ICON_STROKE}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
          <path d="M8 11h6" />
        </svg>
      </ControlButton>
      <span className="w-10 text-center tabular-nums">{zoomPct}%</span>
      <ControlButton
        label={t('放大')}
        onClick={() => {
          const cam = cameraRef.current
          const next = clampZoom(cam.zoom + 0.15, boundsOf(cards, height), view)
          if (next !== cam.zoom) setCameraSync({ ...cam, zoom: next })
        }}
      >
        <svg {...ICON_STROKE}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
          <path d="M11 8v6" />
          <path d="M8 11h6" />
        </svg>
      </ControlButton>
      <span className="mx-0.5 h-3.5 w-px bg-line" />
      <ControlButton
        label={edgeStyle === 'straight' ? t('切换为曲线') : t('切换为直线')}
        onClick={() => {
          const next = EDGE_STYLES[(EDGE_STYLES.indexOf(edgeStyle) + 1) % EDGE_STYLES.length]
          // 只是显示口径，不进撤回栈（Ctrl+Z 不该把线拉回曲线）
          onChange({ ...(saved ?? { version: 2, positions: {} }), edgeStyle: next })
        }}
      >
        <svg {...ICON_STROKE}>
          {edgeStyle === 'straight' ? <path d="M4 18C10 18 14 6 20 6" /> : <path d="M5 19 19 5" />}
        </svg>
      </ControlButton>
      <ControlButton label={t('撤回上一步')} disabled={!canUndo} onClick={undo}>
        <svg {...ICON_STROKE}>
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
        </svg>
      </ControlButton>
      <ControlButton label={t('适应画布')} onClick={fit}>
        <svg {...ICON_STROKE}>
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M16 3h3a2 2 0 0 1 2 2v3" />
          <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </ControlButton>
      <ControlButton label={t('自动排列')} onClick={autoArrange}>
        <svg {...ICON_STROKE}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </ControlButton>
      {onToggleViewMode && (
        <>
          <span className="mx-0.5 h-3.5 w-px bg-line" />
          <ControlButton label={t('切换为大纲树视图')} onClick={onToggleViewMode}>
            <FolderTree size={13} />
          </ControlButton>
        </>
      )}
      <span className="mx-0.5 h-3.5 w-px bg-line" />
      <ControlButton label={t('新手教学')} onClick={onOpenTour}>
        <svg {...ICON_STROKE}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
      </ControlButton>
    </div>
  )
}

/** 顶部节点列表卡：水平排列，只显示图标，悬停向下弹出 tip 显示节点类型 */
export function CanvasPalette({ paletteRef }: { paletteRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={paletteRef}
      data-tour="palette"
      className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-line bg-card/85 p-1.5 shadow-xs backdrop-blur"
    >
      {PALETTE.map((kind) => (
        <div
          key={kind}
          data-palette-kind={kind}
          className="group/palette-item relative flex h-7 w-7 cursor-grab items-center justify-center rounded-lg border border-line/70 bg-paper/70 transition-all hover:scale-105 hover:border-seal/40 hover:bg-seal/[0.06] active:cursor-grabbing"
        >
          {/* 色签用卡片徽章的同一套配色：只显示图标 */}
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${KIND_BADGE[kind]}`}>
            <KindIcon kind={kind} />
          </span>

          {/* 仅在鼠标经过节点项时向下弹出 tip 显示节点类型 */}
          <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-ink shadow-md opacity-0 transition-opacity duration-150 group-hover/palette-item:opacity-100">
            {t(GRAPH_KIND_LABEL[kind])}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * 垃圾桶：**只在拖着节点时出现**（平时它只是一块挡视线的色块），
 * 方形圆角、够大、好瞄准；层级在平面之下，所以被提起的节点永远压在它上面。
 * 删除走统一通道（实体删除），工作区的撤回能退回它。
 */
export function CanvasTrash({ trashRef, overTrash }: { trashRef: RefObject<HTMLDivElement | null>; overTrash: boolean }) {
  return (
    <div
      ref={trashRef}
      className={`absolute bottom-6 left-1/2 z-20 flex h-28 w-44 -translate-x-1/2 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed text-[12px] transition-all ${
        overTrash
          ? 'scale-105 border-rose-500 bg-rose-500/15 text-rose-600 dark:text-rose-300'
          : 'border-line bg-card/80 text-ink-faint'
      }`}
    >
      <Trash2 size={26} />
      {overTrash ? t('松手删除') : t('拖到这里删除')}
    </div>
  )
}

/** 从列表拖出来时跟着指针的那张卡（宽度跟着落地后的种类走：项目卡本来就宽一截） */
export function CanvasPaletteGhost({ paletteKind, paletteAt }: { paletteKind: GNodeKind; paletteAt: { x: number; y: number } }) {
  return (
    <div
      className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-xl border border-seal/40 bg-card/95 px-3 py-2 text-[12px] text-ink shadow-lg"
      style={{ left: paletteAt.x - cardWidthOf(paletteKind) / 2, top: paletteAt.y - CARD_H / 2, width: cardWidthOf(paletteKind), height: CARD_H }}
    >
      <span className={`rounded px-1.5 py-[1px] text-[10px] font-semibold ${KIND_BADGE[paletteKind]}`}>
        {t(GRAPH_KIND_LABEL[paletteKind])}
      </span>
      <span className="text-ink-soft">{t('松手放下')}</span>
    </div>
  )
}

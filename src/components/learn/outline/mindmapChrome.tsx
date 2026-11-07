/*
 * 本文件负责：思维导图画布上**不属于导图本身**的操作界面——右下悬浮工具栏
 * （分支折叠 / 缩放 / 归位 / 切换视图 / 操作说明）、左下角图例，以及工具栏按钮底座。
 * 全部原样搬自 MindmapView.tsx，注释一并带走。
 */
import { useState } from 'react'
import {
  FolderMinus,
  FolderPlus,
  HelpCircle,
  LayoutGrid,
  Maximize2,
  Minus,
  Palette,
  Plus,
  RotateCcw,
} from 'lucide-react'
import { t } from '../../../i18n'
import { MINDMAP_MAX_ZOOM, MINDMAP_MIN_ZOOM } from './mindmapNav'
import { BRANCH_PALETTES } from './mindmapTypes'

/**
 * 大纲页面右下角帮助按钮：鼠标经过时弹出 tip 显示操作说明
 */
export function OutlineHelpButton({ readOnly }: { readOnly?: boolean }) {
  const [showTip, setShowTip] = useState(false)

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <button
        type="button"
        title={t('操作说明')}
        aria-label={t('操作说明')}
        className={`flex h-7 w-7 items-center justify-center rounded-full text-ink-soft transition hover:bg-paper-deep hover:text-ink ${
          showTip ? 'bg-paper-deep text-ink' : ''
        }`}
      >
        <HelpCircle size={13} />
      </button>

      {showTip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute right-0 bottom-full mb-2.5 w-72 select-none rounded-2xl border border-line-strong/80 bg-paper/95 p-3.5 shadow-2xl backdrop-blur-md dark:bg-card/95"
        >
          <div className="mb-2.5 flex items-center gap-1.5 border-b border-line/60 pb-2">
            <HelpCircle size={14} className="text-seal" />
            <span className="text-[12.5px] font-semibold text-ink">{t('思维导图操作说明')}</span>
          </div>
          <div className="space-y-2 text-[11px] leading-relaxed text-ink-soft">
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('平移画面')}</span>
              <span className="text-right text-ink-faint">{t('中键拖拽 / 空格+左键拖拽')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('缩放画面')}</span>
              <span className="text-right text-ink-faint">{t('Ctrl+滚轮（最大 120%）')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('画面滚动')}</span>
              <span className="text-right text-ink-faint">{t('滚轮上下 / Shift+滚轮左右')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('聚焦节点')}</span>
              <span className="text-right text-ink-faint">{t('点击节点（置于垂直 40%）')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('跳转对端')}</span>
              <span className="text-right text-ink-faint">{t('点击连线跳到所连节点')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('全图居中')}</span>
              <span className="text-right text-ink-faint">{t('双击空白处 / 中键双击')}</span>
            </div>
            {readOnly ? (
              <div className="flex items-start justify-between gap-2">
                <span className="shrink-0 font-medium text-ink">{t('打开页签')}</span>
                <span className="text-right text-ink-faint">{t('点击节点标题或图标打开页签')}</span>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <span className="shrink-0 font-medium text-ink">{t('节点改色')}</span>
                <span className="text-right text-ink-faint">{t('右键点击节点打开改色面板')}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** 悬浮工具栏里的一颗按钮：图标 + 可选文字；圆形 hover 底，与胶囊外框呼应 */
export function ToolbarButton({
  onClick,
  title,
  label,
  children,
  disabled = false,
}: {
  onClick: () => void
  title: string
  label?: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex h-7 items-center justify-center gap-1 rounded-full px-2 text-[11px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-ink active:scale-95 disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
      {label && <span>{label}</span>}
    </button>
  )
}

/** 悬浮工具栏：右下胶囊——分支操作 / 缩放 / 视图归位三段，分隔线隔开 */
export function MindmapToolbar({
  expandAll,
  collapseAllBranches,
  zoomOut,
  zoom,
  resetZoom,
  zoomIn,
  fitView,
  onToggleViewMode,
  readOnly,
}: {
  /** 全部展开 */
  expandAll: () => void
  /** 折叠到一级分支 */
  collapseAllBranches: () => void
  zoomOut: () => void
  zoom: number
  resetZoom: () => void
  zoomIn: () => void
  /** 自适应画布（双击空白同效） */
  fitView: () => void
  onToggleViewMode?: () => void
  readOnly: boolean
}) {
  return (
    <div className="absolute right-4 bottom-4 flex items-center gap-0.5 rounded-full border border-line/60 bg-paper/90 p-1 shadow-lg backdrop-blur-md dark:bg-card/90">
      <ToolbarButton onClick={expandAll} title={t('全部展开')} label={t('全展')}>
        <FolderPlus size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={collapseAllBranches} title={t('折叠到一级分支')} label={t('折叠')}>
        <FolderMinus size={13} />
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-line/60" />
      <ToolbarButton onClick={zoomOut} title={t('缩小 (Ctrl+滚轮下)')} disabled={zoom <= MINDMAP_MIN_ZOOM}>
        <Minus size={13} />
      </ToolbarButton>
      <button
        type="button"
        onClick={resetZoom}
        title={t('重置为 100%')}
        className="min-w-11 rounded-full px-1.5 py-1 text-center font-mono text-[11px] font-semibold tabular-nums text-ink-soft transition hover:bg-paper-deep hover:text-ink"
      >
        {Math.round(zoom * 100)}%
      </button>
      <ToolbarButton onClick={zoomIn} title={t('放大 (Ctrl+滚轮上)')} disabled={zoom >= MINDMAP_MAX_ZOOM}>
        <Plus size={13} />
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-line/60" />
      <ToolbarButton onClick={fitView} title={t('自适应画布（双击空白同效）')}>
        <Maximize2 size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={resetZoom} title={t('归位')}>
        <RotateCcw size={13} />
      </ToolbarButton>
      {onToggleViewMode && (
        <>
          <span className="mx-1 h-4 w-px bg-line/60" />
          <ToolbarButton onClick={onToggleViewMode} title={t('切换为拓扑画布')} label={t('拓扑')}>
            <LayoutGrid size={13} />
          </ToolbarButton>
        </>
      )}
      <span className="mx-1 h-4 w-px bg-line/60" />
      <OutlineHelpButton readOnly={readOnly} />
    </div>
  )
}

/** 左下角图例：状态辨认 + 分支色 + 改色提示，收进一颗小胶囊 */
export function MindmapLegend({ readOnly }: { readOnly: boolean }) {
  return (
    <div className="absolute bottom-4 left-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-line/50 bg-paper/90 px-3.5 py-1.5 text-[11px] text-ink-faint shadow-sm backdrop-blur-md dark:bg-card/90">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-ok" />
        {t('已掌握')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full border border-dashed border-ink-faint" />
        {t('未创建')}
      </span>
      <span className="h-3 w-px bg-line/60" />
      <span className="flex items-center gap-1.5 text-[10.5px]">
        {BRANCH_PALETTES.slice(0, 4).map((p) => (
          <span key={p.name} className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
            {p.name}
          </span>
        ))}
      </span>
{!readOnly && (
        <>
          <span className="h-3 w-px bg-line/60" />
          <span className="flex items-center gap-1 text-[10.5px]">
            <Palette size={11} />
            {t('右键节点可改色')}
          </span>
        </>
      )}
    </div>
  )
}

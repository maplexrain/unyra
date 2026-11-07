/**
 * ShotToolbar.tsx — 截图工具条（展示组件）
 * 职责：渲染主工具条（绘制工具切换、撤销、下载、置顶贴图、取消、确定复制）
 * 与属性子工具条（调色板、线宽）。纯展示：逐项 props + 内联回调，不持有任何状态。
 */
import type { CSSProperties } from 'react'
import {
  ArrowUpRight,
  Check,
  Circle,
  Download,
  Grid,
  Pin,
  Square,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import { t } from '../../../i18n'
import type { ToolType } from './types'

const COLOR_PALETTE = [
  '#ef4444', // 红
  '#f97316', // 橙
  '#eab308', // 黄
  '#22c55e', // 绿
  '#3b82f6', // 蓝
  '#a855f7', // 紫
  '#ffffff', // 白
  '#000000', // 黑
]

const STROKE_WIDTHS = [2, 4, 6]

export interface ShotToolbarProps {
  style: CSSProperties
  tool: ToolType
  activeColor: string
  strokeWidth: number
  /** 当前标注对象数量（为 0 时撤销按钮禁用） */
  objectsCount: number
  /** 是否显示属性子工具条（绘制工具激活或存在选中对象） */
  showSubToolbar: boolean
  onToolToggle: (tool: ToolType) => void
  onUndo: () => void
  onDownload: () => void
  onPin: () => void
  onCancel: () => void
  onConfirm: () => void
  onColorChange: (c: string) => void
  onStrokeWidthChange: (sw: number) => void
}

export default function ShotToolbar({
  style,
  tool,
  activeColor,
  strokeWidth,
  objectsCount,
  showSubToolbar,
  onToolToggle,
  onUndo,
  onDownload,
  onPin,
  onCancel,
  onConfirm,
  onColorChange,
  onStrokeWidthChange,
}: ShotToolbarProps) {
  return (
    <div
      style={style}
      className="screenshot-toolbar absolute z-30 flex flex-col gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 主工具条 */}
      <div className="flex items-center gap-1 rounded-xl border border-line-strong/80 bg-card/95 p-1 shadow-2xl backdrop-blur-md text-ink">
        {/* 1. 线框 */}
        <button
          type="button"
          title={t('线框 (矩形)')}
          onClick={() => onToolToggle(tool === 'rect' ? 'none' : 'rect')}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
            tool === 'rect' ? 'bg-seal text-white' : 'hover:bg-line/60 text-ink-soft hover:text-ink'
          }`}
        >
          <Square size={15} />
        </button>

        {/* 2. 圆框 */}
        <button
          type="button"
          title={t('圆框 (椭圆)')}
          onClick={() => onToolToggle(tool === 'circle' ? 'none' : 'circle')}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
            tool === 'circle' ? 'bg-seal text-white' : 'hover:bg-line/60 text-ink-soft hover:text-ink'
          }`}
        >
          <Circle size={15} />
        </button>

        {/* 3. 箭头（附带尾部说明文本框） */}
        <button
          type="button"
          title={t('箭头标注（附带说明框）')}
          onClick={() => onToolToggle(tool === 'arrow' ? 'none' : 'arrow')}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
            tool === 'arrow' ? 'bg-seal text-white' : 'hover:bg-line/60 text-ink-soft hover:text-ink'
          }`}
        >
          <ArrowUpRight size={17} />
        </button>

        {/* 4. 马赛克 */}
        <button
          type="button"
          title={t('马赛克框选')}
          onClick={() => onToolToggle(tool === 'mosaic' ? 'none' : 'mosaic')}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
            tool === 'mosaic' ? 'bg-seal text-white' : 'hover:bg-line/60 text-ink-soft hover:text-ink'
          }`}
        >
          <Grid size={15} />
        </button>

        {/* 5. 文字 */}
        <button
          type="button"
          title={t('文字批注')}
          onClick={() => onToolToggle(tool === 'text' ? 'none' : 'text')}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
            tool === 'text' ? 'bg-seal text-white' : 'hover:bg-line/60 text-ink-soft hover:text-ink'
          }`}
        >
          <Type size={16} />
        </button>

        {/* 撤销 */}
        <button
          type="button"
          title={t('撤销 (Ctrl+Z)')}
          disabled={objectsCount === 0}
          onClick={() => onUndo()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-line/60 hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
        >
          <Undo2 size={15} />
        </button>

        <div className="mx-0.5 h-4 w-px bg-line/60" />

        {/* 6. 下载 */}
        <button
          type="button"
          title={t('下载 / 保存')}
          onClick={() => onDownload()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-line/60 hover:text-ink"
        >
          <Download size={15} />
        </button>

        {/* 7. 指定 / 置顶贴图 */}
        <button
          type="button"
          title={t('指定 / 置顶贴图')}
          onClick={() => onPin()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-line/60 hover:text-ink"
        >
          <Pin size={15} />
        </button>

        {/* 取消 / 关闭 */}
        <button
          type="button"
          title={t('取消 (Esc)')}
          onClick={() => onCancel()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-red-500/20 hover:text-red-500"
        >
          <X size={16} />
        </button>

        {/* 8. 确定（复制到剪贴板） */}
        <button
          type="button"
          title={t('确定 (复制到剪贴板并退出)')}
          onClick={() => onConfirm()}
          className="flex h-8 items-center gap-1 rounded-lg bg-seal px-2.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-seal/90"
        >
          <Check size={14} />
          <span>{t('确定')}</span>
        </button>
      </div>

      {/* 属性子工具条（联动编辑当前选中对象或新建属性） */}
      {showSubToolbar && (
        <div className="flex items-center justify-between rounded-xl border border-line-strong/80 bg-card/95 px-2.5 py-1.5 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-1.5">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onColorChange(c)}
                style={{ backgroundColor: c }}
                className={`h-4 w-4 rounded-full border ${
                  activeColor === c ? 'ring-2 ring-seal ring-offset-1 border-white shadow-md' : 'border-black/20 hover:border-black/50'
                }`}
              />
            ))}
          </div>

          {tool !== 'text' && (
            <div className="flex items-center gap-1 pl-2 border-l border-line/60">
              {STROKE_WIDTHS.map((sw) => (
                <button
                  key={sw}
                  type="button"
                  onClick={() => onStrokeWidthChange(sw)}
                  className={`flex h-5 w-5 items-center justify-center rounded ${
                    strokeWidth === sw ? 'bg-line text-seal font-bold' : 'text-ink-soft hover:bg-line/50'
                  }`}
                >
                  <div
                    style={{ height: `${sw}px`, width: '12px', backgroundColor: activeColor }}
                    className="rounded-full"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

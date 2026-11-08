/**
 * ScreenshotEditor.tsx — 截图编辑器门面组件
 * 职责：组装截图编辑器的各拆分模块（对外导出保持不变：ScreenshotEditorProps + default）：
 * - useShotAssets   原图预加载与离屏画布资源
 * - useShotHistory  标注对象与撤销
 * - useShotSelection 选区与窗口自动吸附状态
 * - useShotLoupe    取色放大镜
 * - useShotExport   最终裁切画布与下载 / 置顶 / 复制动作
 * - useShotCanvas   画布交互机制（鼠标 / 键盘 / 光标 / 文字编辑）
 * - useShotRender   主画布渲染
 * - ShotToolbar     工具条展示组件
 */
import { useRef } from 'react'
import { t } from '../../../i18n'
import type { PinnedItemData } from './types'
import { getLoupeStyle, getToolbarStyle } from './shotGeometry'
import { useShotHistory } from './useShotHistory'
import { useShotAssets } from './useShotAssets'
import { useShotSelection } from './useShotSelection'
import { useShotLoupe } from './useShotLoupe'
import { useShotExport } from './useShotExport'
import { useShotCanvas } from './useShotCanvas'
import { useShotRender } from './useShotRender'
import ShotToolbar from './ShotToolbar'

export interface ScreenshotEditorProps {
  imageSrc: string
  onClose: () => void
  onPin: (pinned: PinnedItemData) => void
  onToast: (msg: string) => void
  onReady?: () => void
}

export default function ScreenshotEditor({
  imageSrc,
  onClose,
  onPin,
  onToast,
  onReady,
}: ScreenshotEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // 编辑历史（标注对象与撤销）
  const history = useShotHistory()
  // 画布与离屏资源（原图预加载 / 首帧就绪 / 晚绑定渲染挂点）
  const assets = useShotAssets({ imageSrc, onReady })
  // 选区与窗口自动吸附
  const sel = useShotSelection()
  // 放大镜与颜色拾取
  const loupe = useShotLoupe({ offscreenCanvasRef: assets.offscreenCanvasRef, onToast })
  // 结果产出（下载保存 / 置顶贴图 / 复制到剪贴板）
  const exporter = useShotExport({
    selection: sel.selection,
    objects: history.objects,
    imageElementRef: assets.imageElementRef,
    offscreenCanvasRef: assets.offscreenCanvasRef,
    onClose,
    onPin,
    onToast,
  })
  // 画布交互机制（选区 / 标注对象 / 文字编辑 / 快捷键 / 光标）
  const canvas = useShotCanvas({
    sel,
    history,
    loupe,
    offscreenCanvasRef: assets.offscreenCanvasRef,
    onClose,
    onConfirm: exporter.handleConfirm,
  })
  // 主画布渲染（选区遮罩 / 候选窗口高亮 / 标注对象）
  const render = useShotRender({
    selection: sel.selection,
    hoveredWindowRect: sel.hoveredWindowRect,
    isSelecting: sel.isSelecting,
    objects: history.objects,
    draftObject: canvas.draftObject,
    selectedObjectId: history.selectedObjectId,
    tool: canvas.tool,
    isLoaded: assets.isLoaded,
    offscreenCanvasRef: assets.offscreenCanvasRef,
    drawMainRef: assets.drawMainRef,
  })

  const {
    selection,
    hoveredWindowRect,
    isSelecting,
    selectionResizeHandle,
  } = sel
  const {
    tool,
    activeColor,
    strokeWidth,
    editingTarget,
    setEditingTarget,
    handleCommitEditing,
    textInputRef,
    currentCursor,
    handleColorChange,
    handleStrokeWidthChange,
    setTool,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleDoubleClick,
    handleContextMenu,
  } = canvas
  const { mousePos, colorMode, currentColor, copiedNotice, loupeCanvasRef } = loupe
  const { canvasRef } = render

  // 属性子工具条显隐（原条件：绘制工具激活或存在选中对象）
  const showSubToolbar = tool === 'rect' || tool === 'circle' || tool === 'arrow' || tool === 'text' || history.selectedObjectId !== null

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      style={{ cursor: currentCursor }}
      className="fixed inset-0 z-[9999] select-none overflow-hidden"
    >
      {/* 底层硬件加速原图：100% 确保任何情况下屏幕画面绝无黑屏 */}
      <img
        src={imageSrc}
        alt="captured desktop"
        className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none -z-10"
        draggable={false}
      />
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* 尚未选取时的操作指引 */}
      {!selection && assets.isLoaded && (
        <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-white/20 bg-black/85 px-4 py-1.5 text-xs text-white/95 shadow-2xl backdrop-blur-md">
          <span>{t('单击选取窗口 · 拖拽自由框选 · 双击复制 · 右键退出')}</span>
          <span className="text-white/40">|</span>
          <span className="text-white/60">{t('Shift 换色 · F1 唤出')}</span>
        </div>
      )}

      {/* 自动捕捉候选窗口的实时尺寸展示在左上角 */}
      {!selection && hoveredWindowRect && (
        <div
          style={{
            left: `${Math.max(10, Math.min(window.innerWidth - 110, hoveredWindowRect.x))}px`,
            top: `${hoveredWindowRect.y >= 32 ? hoveredWindowRect.y - 28 : hoveredWindowRect.y + 8}px`,
          }}
          className="pointer-events-none absolute z-30 flex items-center justify-center rounded-md bg-black/85 px-2 py-0.8 font-mono text-[11px] font-bold text-sky-400 shadow-lg backdrop-blur-sm border border-sky-400/30"
        >
          {Math.round(hoveredWindowRect.width)} × {Math.round(hoveredWindowRect.height)}
        </div>
      )}

      {/* 实时选框尺寸展示在左上角 */}
      {selection && (selection.width > 2 || selection.height > 2) && (
        <div
          style={{
            left: `${Math.max(10, Math.min(window.innerWidth - 110, selection.x))}px`,
            top: `${selection.y >= 32 ? selection.y - 28 : selection.y + 8}px`,
          }}
          className="pointer-events-none absolute z-30 flex items-center justify-center rounded-md bg-black/85 px-2 py-0.8 font-mono text-[11px] font-bold text-sky-400 shadow-lg backdrop-blur-sm border border-sky-400/30"
        >
          {Math.round(selection.width)} × {Math.round(selection.height)}
        </div>
      )}

      {/* 箭头连接文本框或独立文字编辑浮层 */}
      {editingTarget && (
        <div
          style={{
            left: `${editingTarget.x - (editingTarget.type === 'arrowTail' ? 70 : 0)}px`,
            top: `${editingTarget.y - (editingTarget.type === 'arrowTail' ? 36 : 0)}px`,
          }}
          className="text-editor-box absolute z-40"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            ref={textInputRef}
            value={editingTarget.text}
            onChange={(e) => setEditingTarget({ ...editingTarget, text: e.target.value })}
            onKeyDown={(e) => {
              // 中文输入法组合敲回车选字时放行
              if (e.nativeEvent.isComposing || e.key === 'Process') return
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCommitEditing()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEditingTarget(null)
              }
            }}
            onBlur={handleCommitEditing}
            placeholder={editingTarget.type === 'arrowTail' ? t('输入箭头说明...') : t('输入文字...')}
            style={{
              borderColor: activeColor,
              color: editingTarget.type === 'arrowTail' ? '#ffffff' : activeColor,
            }}
            className="rounded-lg border-2 bg-slate-950/95 px-2.5 py-1 text-[14px] font-semibold shadow-2xl outline-none min-w-[140px]"
          />
        </div>
      )}

      {/* 像素级取色放大镜（尺度舒适，微调友好，选取时跟随光标） */}
      {mousePos.x > 0 && (!selection || isSelecting) && !editingTarget && !selectionResizeHandle && (
        <div
          style={getLoupeStyle(mousePos)}
          className="pointer-events-none absolute z-20 flex flex-col items-center rounded-xl border border-white/20 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur-md text-white w-[115px]"
        >
          <div className="relative overflow-hidden rounded-md border border-white/10 shadow-inner">
            <canvas ref={loupeCanvasRef} className="block" />
          </div>

          <div className="mt-1.5 flex w-full items-center justify-between gap-1 px-0.5">
            <span
              style={{ backgroundColor: currentColor }}
              className="h-3 w-3 shrink-0 rounded-full border border-white/40 shadow-sm"
            />
            <span className="font-mono text-[10.5px] font-semibold tracking-tight text-white/95 truncate">
              {currentColor}
            </span>
            <span className="shrink-0 rounded bg-white/10 px-1 py-0.2 text-[8.5px] font-medium text-white/70">
              {colorMode}
            </span>
          </div>

          <div className="mt-0.5 flex w-full justify-between text-[9px] text-zinc-400 px-0.5 font-mono">
            <span>{`X:${Math.round(mousePos.x)} Y:${Math.round(mousePos.y)}`}</span>
          </div>

          <div className="mt-1 border-t border-white/10 pt-0.5 flex w-full justify-between text-[8px] text-zinc-400">
            <span>Shift 换模式</span>
            <span className={copiedNotice ? 'text-green-400 font-bold' : ''}>
              {copiedNotice ? t('已复制!') : 'Ctrl+C 复制'}
            </span>
          </div>
        </div>
      )}

      {/* 截图工具条 */}
      {selection && selection.width > 15 && selection.height > 15 && (
        <ShotToolbar
          style={getToolbarStyle(selection)}
          tool={tool}
          activeColor={activeColor}
          strokeWidth={strokeWidth}
          objectsCount={history.objects.length}
          showSubToolbar={showSubToolbar}
          onToolToggle={setTool}
          onUndo={history.undo}
          onDownload={exporter.handleDownload}
          onPin={exporter.handlePin}
          onCancel={onClose}
          onConfirm={exporter.handleConfirm}
          onColorChange={handleColorChange}
          onStrokeWidthChange={handleStrokeWidthChange}
        />
      )}
    </div>
  )
}

/**
 * PDF 浏览界面的右键菜单（fixed 贴指针，与资源管理器 RowMenu / 文档右键菜单同一套
 * 骨架：useDismissOn 收起、useClampToViewport 夹视口）。
 *
 * 目前只有一项：「清除本文档 OCR 缓存」——OCR 结果按文档纪元入键（见 capsCache 的
 * docOcrEpoch），清缓存 = 纪元 +1，旧条目全部作废，下一次浏览会真重新识别。
 * 这是调试与验收 OCR 挂贴效果的入口：改引擎、换识别档之后清一下，立刻按新配置重跑。
 */

import { useRef } from 'react'
import { Eraser, ScanSearch, Tags } from 'lucide-react'
import { useClampToViewport, useDismissOn } from '../../../lib/useDismiss'
import { t } from '../../../i18n'

const MENU_ITEM = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition'

export interface PdfMenuState {
  x: number
  y: number
  /** 右键落点所在的页（挂贴诊断对着那一页看） */
  pageNum: number
}

interface Props {
  menu: PdfMenuState | null
  onClose: () => void
  onClearOcrCache: () => void
  onInspectOcr: (pageNum: number) => void
  /** 挂贴文字显隐（调试态），点击切换 */
  showOcrText: boolean
  onToggleOcrText: () => void
}

export function PdfContextMenu({ menu, onClose, onClearOcrCache, onInspectOcr, showOcrText, onToggleOcrText }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)

  if (!menu) return null

  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{ left: menu.x, top: menu.y }}
      className="moji-in-soft fixed z-[70] min-w-[190px] max-w-[240px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose()
          onInspectOcr(menu.pageNum)
        }}
        className={MENU_ITEM + ' text-ink hover:bg-line/60'}
      >
        <ScanSearch size={13} className="shrink-0 text-ink-soft" />
        {t('查看本页 OCR 识别详情')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose()
          onToggleOcrText()
        }}
        className={MENU_ITEM + ' text-ink hover:bg-line/60'}
      >
        <Tags size={13} className="shrink-0 text-ink-soft" />
        {showOcrText ? t('隐藏挂贴文字') : t('显示挂贴文字（对齐调试）')}
      </button>
      <span aria-hidden="true" className="my-1 block h-px bg-line" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose()
          onClearOcrCache()
        }}
        className={MENU_ITEM + ' text-ink hover:bg-line/60'}
      >
        <Eraser size={13} className="shrink-0 text-ink-soft" />
        {t('清除本文档 OCR 缓存')}
      </button>
    </div>
  )
}

import { useState, useRef, useEffect } from 'react'
import { Copy, Download, X } from 'lucide-react'
import { native } from '../../lib/native'
import { t } from '../../i18n'

export interface PinnedItem {
  id: string
  dataUrl: string
  width: number
  height: number
  x: number
  y: number
}

export interface PinnedScreenshotProps {
  item: PinnedItem
  onClose: (id: string) => void
  onToast: (msg: string) => void
}

export default function PinnedScreenshot({ item, onClose, onToast }: PinnedScreenshotProps) {
  const [pos, setPos] = useState({ x: item.x, y: item.y })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 60, dragRef.current.origX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, dragRef.current.origY + dy)),
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      dragRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    }
  }

  const handleCopy = async () => {
    try {
      const bridge = native()
      if (bridge.tools?.copyImage) {
        await bridge.tools.copyImage(item.dataUrl)
      } else {
        const res = await fetch(item.dataUrl)
        const blob = await res.blob()
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        }
      }
      onToast(t('截图已复制到剪贴板'))
    } catch {
      onToast(t('复制失败'))
    }
  }

  const handleDownload = async () => {
    try {
      const bridge = native()
      const suggestedName = `Screenshot_Pin_${Date.now()}.png`
      if (bridge.tools?.saveImage) {
        await bridge.tools.saveImage({ suggestedName, dataUrl: item.dataUrl })
      } else {
        const a = document.createElement('a')
        a.href = item.dataUrl
        a.download = suggestedName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
      onToast(t('截图已保存'))
    } catch {
      onToast(t('保存失败'))
    }
  }

  return (
    <div
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleCopy}
      title={t('双击复制，按住拖动')}
      className="group fixed z-50 cursor-move select-none rounded-lg border border-line-strong/80 bg-card shadow-2xl overflow-hidden transition-shadow hover:shadow-cyan-500/10"
    >
      <div className="relative">
        <img
          src={item.dataUrl}
          alt={t('置顶贴图')}
          style={{ width: `${item.width}px`, height: `${item.height}px` }}
          className="block max-h-[80vh] max-w-[80vw] object-contain pointer-events-none"
        />

        {/* 顶部悬浮操作栏 */}
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md bg-black/70 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
          <button
            type="button"
            title={t('复制到剪贴板')}
            onClick={(e) => {
              e.stopPropagation()
              handleCopy()
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-white/80 hover:bg-white/20 hover:text-white"
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            title={t('保存到文件')}
            onClick={(e) => {
              e.stopPropagation()
              handleDownload()
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-white/80 hover:bg-white/20 hover:text-white"
          >
            <Download size={13} />
          </button>
          <button
            type="button"
            title={t('关闭置顶')}
            onClick={(e) => {
              e.stopPropagation()
              onClose(item.id)
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-white/80 hover:bg-red-500 hover:text-white"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState, useRef } from 'react'
import { Copy, Download, X, Check } from 'lucide-react'
import { native } from '../../lib/native'
import type { PinnedItemData } from './screenshot/types'

export interface PinWindowAppProps {
  pinId: string
}

export default function PinWindowApp({ pinId }: PinWindowAppProps) {
  const [pinData, setPinData] = useState<PinnedItemData | null>(null)
  const [copied, setCopied] = useState(false)
  const [zoomFactor, setZoomFactor] = useState(1.0)
  const zoomFactorRef = useRef(1.0)
  zoomFactorRef.current = zoomFactor

  useEffect(() => {
    const fetchData = async () => {
      try {
        const bridge = native()
        if (bridge.tools?.getPinData) {
          const data = await bridge.tools.getPinData(pinId)
          if (data) {
            setPinData(data)
            return
          }
        }
        // WebUI / sessionStorage 兜底
        const cached = sessionStorage.getItem(`pin_${pinId}`)
        if (cached) {
          setPinData(JSON.parse(cached))
        }
      } catch (err) {
        console.error('[PinWindow] load error:', err)
      }
    }
    void fetchData()
  }, [pinId])

  // 键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        void handleCopy()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleSave()
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pinId, pinData])

  const handleClose = () => {
    const bridge = native()
    if (bridge.tools?.closePin) {
      bridge.tools.closePin(pinId)
    } else {
      window.close()
    }
  }

  const handleCopy = async () => {
    if (!pinData) return
    try {
      const bridge = native()
      if (bridge.tools?.copyPin) {
        await bridge.tools.copyPin(pinId)
      } else {
        await bridge.tools?.copyImage(pinData.dataUrl)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  const handleSave = async () => {
    if (!pinData) return
    try {
      const bridge = native()
      if (bridge.tools?.savePin) {
        await bridge.tools.savePin(pinId)
      } else {
        await bridge.tools?.saveImage({
          suggestedName: `Pin_${Date.now()}.png`,
          dataUrl: pinData.dataUrl,
        })
      }
    } catch {}
  }

  // 鼠标滚轮无级缩放贴图
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.1 : -0.1
    const next = Math.max(0.5, Math.min(3.0, Math.round((zoomFactorRef.current + delta) * 10) / 10))
    if (next !== zoomFactorRef.current) {
      setZoomFactor(next)
      const bridge = native()
      bridge.tools?.zoomPin?.(pinId, next)
    }
  }

  if (!pinData) {
    return <div className="fixed inset-0 bg-transparent" />
  }

  return (
    <div
      onWheel={handleWheel}
      onDoubleClick={handleClose}
      style={{
        // 允许直接在整个贴图上拖拽移动独立桌面窗口
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
      className="group relative h-screen w-screen cursor-move select-none overflow-hidden bg-transparent rounded-lg border border-sky-400/40 shadow-2xl"
    >
      <img
        src={pinData.dataUrl}
        alt="pinned screenshot"
        className="block h-full w-full object-contain pointer-events-none select-none"
        draggable={false}
      />

      {/* 悬停浮现的操作条 */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="absolute top-2 right-2 flex items-center gap-1 rounded-full border border-white/20 bg-slate-950/85 px-1.5 py-0.5 shadow-xl backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-150"
      >
        <button
          type="button"
          title="复制到剪贴板 (Ctrl+C)"
          onClick={(e) => {
            e.stopPropagation()
            void handleCopy()
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 hover:bg-white/20 hover:text-white transition"
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
        </button>

        <button
          type="button"
          title="保存图片 (Ctrl+S)"
          onClick={(e) => {
            e.stopPropagation()
            void handleSave()
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 hover:bg-white/20 hover:text-white transition"
        >
          <Download size={12} />
        </button>

        <button
          type="button"
          title="关闭贴图 (Esc / 双击)"
          onClick={(e) => {
            e.stopPropagation()
            handleClose()
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 hover:bg-red-500 hover:text-white transition"
        >
          <X size={12} />
        </button>
      </div>

      {/* 贴图尺寸徽标 */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="pointer-events-none absolute bottom-1 right-1.5 rounded bg-black/70 px-1 py-0.2 font-mono text-[9px] text-sky-400/90 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {Math.round(pinData.width * zoomFactor)} × {Math.round(pinData.height * zoomFactor)}
      </div>
    </div>
  )
}

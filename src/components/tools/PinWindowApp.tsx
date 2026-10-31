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

  // JS 拖拽窗口平移（不依赖 -webkit-app-region: drag，彻底解除 Chromium 拦截 wheel 和 dblclick 事件的限制）
  const dragStartRef = useRef<{ screenX: number; screenY: number } | null>(null)

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

  // 首帧图片加载就绪后，通知主进程无缝呈现贴图并关闭截图全屏窗口
  const handleImageLoaded = () => {
    const bridge = native()
    bridge.tools?.notifyPinReady?.(pinId)
  }

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

  // 鼠标拖动窗口实现（纯原生 JS 坐标，跨屏无级平滑移动）
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    dragStartRef.current = { screenX: e.screenX, screenY: e.screenY }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return
      const dx = e.screenX - dragStartRef.current.screenX
      const dy = e.screenY - dragStartRef.current.screenY
      if (dx !== 0 || dy !== 0) {
        dragStartRef.current = { screenX: e.screenX, screenY: e.screenY }
        const bridge = native()
        bridge.tools?.movePin?.(pinId, dx, dy)
      }
    }
    const handleMouseUp = () => {
      dragStartRef.current = null
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [pinId])

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

  // 鼠标滚轮缩放贴图窗口
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY < 0 ? 0.1 : -0.1
    const next = Math.max(0.2, Math.min(5.0, Math.round((zoomFactorRef.current + delta) * 10) / 10))
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
      onMouseDown={handleMouseDown}
      onDoubleClick={handleClose}
      className="group relative h-screen w-screen cursor-move select-none overflow-hidden bg-transparent rounded-lg border border-sky-400/50 shadow-2xl"
    >
      <img
        src={pinData.dataUrl}
        alt="pinned screenshot"
        onLoad={handleImageLoaded}
        className="block h-full w-full object-contain pointer-events-none select-none"
        draggable={false}
      />

      {/* 悬停浮现的操作条 */}
      <div
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

      {/* 贴图尺寸与缩放徽标 */}
      <div
        className="pointer-events-none absolute bottom-1 right-1.5 flex items-center gap-1 rounded bg-black/70 px-1 py-0.2 font-mono text-[9px] text-sky-400/90 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <span>{Math.round(pinData.width * zoomFactor)} × {Math.round(pinData.height * zoomFactor)}</span>
        <span className="text-zinc-400">({Math.round(zoomFactor * 100)}%)</span>
      </div>
    </div>
  )
}

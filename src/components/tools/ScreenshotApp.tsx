import { useEffect, useState } from 'react'
import { native } from '../../lib/native'
import ScreenshotEditor from './screenshot/ScreenshotEditor'
import type { PinnedItemData } from './screenshot/types'

export default function ScreenshotApp() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [sessionKey, setSessionKey] = useState(0)

  useEffect(() => {
    const bridge = native()

    // 1. 页面挂载时获取主进程截取的桌面全分辨率图像
    const fetchImage = async () => {
      try {
        if (bridge.tools?.getScreenshotImage) {
          const data = await bridge.tools.getScreenshotImage()
          if (data) {
            setImageSrc(data)
            setSessionKey((k) => k + 1)
          }
        }
      } catch {}
    }
    void fetchImage()

    // 2. 监听后续每次截图的实时注入推送（复用常驻待命窗口，消灭开窗与页面重载耗时）
    const unsub = bridge.tools?.onScreenshotUpdate?.((payload) => {
      if (payload && payload.imageSrc) {
        setImageSrc(payload.imageSrc)
        setSessionKey((k) => k + 1)
      }
    })

    return () => unsub?.()
  }, [])

  const handleReady = () => {
    // 首帧绘制完成后通知主进程显式展示窗口，消除任何闪烁
    const bridge = native()
    bridge.tools?.notifyScreenshotReady?.()
  }

  const handleClose = () => {
    const bridge = native()
    bridge.tools?.closeScreenshot?.()
  }

  const handlePin = (pinned: PinnedItemData) => {
    const bridge = native()
    bridge.tools?.pinScreenshot?.(pinned)
  }

  const handleToast = (msg: string) => {
    console.log('[Screenshot]', msg)
  }

  if (!imageSrc) {
    return <div className="fixed inset-0 bg-transparent" />
  }

  return (
    <ScreenshotEditor
      key={sessionKey}
      imageSrc={imageSrc}
      onReady={handleReady}
      onClose={handleClose}
      onPin={handlePin}
      onToast={handleToast}
    />
  )
}

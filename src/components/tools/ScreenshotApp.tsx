import { useEffect, useState } from 'react'
import { native } from '../../lib/native'
import ScreenshotEditor from './screenshot/ScreenshotEditor'
import type { PinnedItemData } from './screenshot/types'

export default function ScreenshotApp() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)

  useEffect(() => {
    // 页面启动时获取主进程截取的桌面全分辨率图像
    const fetchImage = async () => {
      try {
        const bridge = native()
        if (bridge.tools?.getScreenshotImage) {
          const data = await bridge.tools.getScreenshotImage()
          if (data) {
            setImageSrc(data)
          }
        }
      } catch {}
    }
    void fetchImage()
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
    // 截图窗口中显示简单操作提示（或通过原生通道）
    console.log('[Screenshot]', msg)
  }

  if (!imageSrc) {
    return <div className="fixed inset-0 bg-transparent" />
  }

  return (
    <ScreenshotEditor
      imageSrc={imageSrc}
      onReady={handleReady}
      onClose={handleClose}
      onPin={handlePin}
      onToast={handleToast}
    />
  )
}

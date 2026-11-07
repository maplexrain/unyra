import { useCallback, useState } from 'react'
import { native } from '../../../lib/native'
import { useShortcut } from '../../../lib/useShortcut'
import { t } from '../../../i18n'

/** 截图工具需要的宿主能力 */
export interface ScreenshotToolDeps {
  onToast: (msg: string) => void
}

/* ---------- 实用工具箱：屏幕截图 ---------- */
export function useScreenshotTool({ onToast }: ScreenshotToolDeps) {
  const [screenshotImage, setScreenshotImage] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)

  const handleStartScreenshot = useCallback(async () => {
    if (isCapturing) return
    setIsCapturing(true)
    try {
      const bridge = native()
      // 1. Electron 桌面端优先调起系统层级全屏截图窗口
      if (bridge.tools?.openScreenshot) {
        const res = await bridge.tools.openScreenshot()
        if (!res.ok) {
          onToast(res.error || t('未能启动截图'))
        }
        return
      }

      // 2. WebUI 模式通过服务端/浏览器捕获并在工作区唤起全屏编辑
      if (bridge.tools?.captureScreen) {
        const res = await bridge.tools.captureScreen()
        if (res.ok) {
          setScreenshotImage(res.dataUrl)
        } else {
          onToast(res.error || t('未能获取截图画面'))
        }
      } else {
        onToast(t('当前环境不支持屏幕截图'))
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : t('截图启动失败'))
    } finally {
      setIsCapturing(false)
    }
  }, [isCapturing, onToast])

  // 截图工具快捷键改用 F1 唤出
  useShortcut('tools.screenshot', { down: handleStartScreenshot })

  return { screenshotImage, setScreenshotImage, isCapturing, handleStartScreenshot }
}

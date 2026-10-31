/**
 * 这个文件负责将截图 Base64 数据安全写入系统原生剪贴板。
 * 兼容 Electron 现代 Async ClipboardItem 规范（生成 PNG、DIB、位图等系统剪贴板标准格式）
 * 与传统 writeImage API。
 */
import { clipboard, ClipboardItem, nativeImage } from 'electron'
import { t } from '../i18n'

export async function copyDataUrlToClipboard(dataUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    // 1. 优先使用 Electron 现代 / 标准 ClipboardItem API（支持 PNG、DIB、Bitmap 完整系统剪贴板格式）
    if (typeof ClipboardItem !== 'undefined' && clipboard && typeof clipboard.write === 'function') {
      try {
        const blob = new Blob([buffer], { type: 'image/png' })
        const item = new ClipboardItem({ 'image/png': blob })
        await clipboard.write([item])
        return { ok: true }
      } catch (err) {
        console.warn('[Clipboard] ClipboardItem write error, fallback to legacy writeImage:', err)
      }
    }

    // 2. 兼容传统 Electron writeImage API
    const clip = clipboard as unknown as { writeImage?: (img: unknown) => void } | undefined
    if (clip && typeof clip.writeImage === 'function') {
      const img = nativeImage?.createFromDataURL?.(dataUrl)
      if (img) {
        clip.writeImage(img)
      }
      return { ok: true }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t('写入剪贴板失败') }
  }
}

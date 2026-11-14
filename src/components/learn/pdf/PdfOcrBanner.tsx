/**
 * PDF 顶部的「OCR 未接入」横幅（纯展示）。
 *
 * 显隐逻辑归父级（PdfDocView）：扫描件挂不出文字层时 onRequireOcr 会把 dismissed
 * 复位（横幅再请出来），所以 dismissed 状态留在父级——这里只管长相与跳转。
 * 「接入 OCR」走 moji:open-caps 直开「设置 → 模型 → 能力接入」（见 SettingsPanel）。
 */

import { Sparkles, X } from 'lucide-react'
import { t } from '../../../i18n'

interface Props {
  /** OCR 已接入（能力配置里 mode !== 'off' 且参数齐全） */
  enabled: boolean
  dismissed: boolean
  onDismiss: () => void
}

export function PdfOcrBanner({ enabled, dismissed, onDismiss }: Props) {
  if (enabled || dismissed) return null

  return (
    <div className="no-print flex items-center justify-between border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[12px] text-ink-strong select-none">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles size={14} className="text-amber-500 shrink-0" />
        <span className="truncate">
          {t('当前未接入 OCR 文字识别，扫描件页面文字暂无法直接框选与复制。可在「设置 → 模型 → 能力接入」中启用（DeepSeek 或本地服务）。')}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <button
          type="button"
          onClick={handleOpenOcrConfig}
          className="rounded-none bg-seal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-seal-deep transition"
        >
          {t('接入 OCR')}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          title={t('关闭提示')}
          className="p-1 text-ink-soft hover:text-ink transition"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

/** 打开设置并直开「模型 → 能力接入」（SettingsPanel 监听 moji:open-caps） */
function handleOpenOcrConfig(): void {
  try {
    localStorage.setItem('moji:settings:tab', 'ai')
  } catch {}
  window.dispatchEvent(new CustomEvent('moji:open-caps', { detail: 'ocr' }))
  window.dispatchEvent(new CustomEvent('moji:open-tab', { detail: { kind: 'settings' } }))
}

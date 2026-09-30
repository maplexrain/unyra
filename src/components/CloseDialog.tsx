/**
 * 关窗询问对话框：点关闭时问一次「直接关闭还是收进托盘」。
 *
 * 只在关窗行为是「询问」时出现，弹不弹由主进程决定（见 electron/main.ts 的 attachCloseGuard）。
 * 勾上「不再询问」再选一次，这次的选择就会被存成策略——存的是「直接关闭」还是
 * 「最小化到托盘」由点的那颗按钮决定，不是另设一项。
 */

import { useState } from 'react'
import { useEscapeKey } from '../lib/useEscape'
import { Minimize2, Power, X } from 'lucide-react'
import type { CloseAction } from '../lib/native'
import { t } from '../i18n'
import ModalScrim from './ModalScrim'

interface Props {
  /** 用户的选择：cancel 表示这次不关，窗口留着 */
  onDecide: (action: CloseAction, remember: boolean) => void
}

export default function CloseDialog({ onDecide }: Props) {
  const [remember, setRemember] = useState(false)

  // Esc 与右上角的 X、点遮罩一致：这次不关
  useEscapeKey(() => onDecide('cancel', false))

  return (
    <ModalScrim z="z-[70]" onClose={() => onDecide('cancel', false)}>
      <div
        role="alertdialog"
        aria-label={t('关闭窗口')}
        className="moji-dialog-in w-full max-w-sm rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.3)]"
      >
        <div className="flex items-start gap-2.5 border-b border-line px-5 py-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-seal/12 text-seal">
            <Power size={14} />
          </span>
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-ink-strong">{t('关闭窗口？')}</h2>
          <button
            type="button"
            title={t('这次不关')}
            onClick={() => onDecide('cancel', false)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 text-[13px] leading-relaxed text-ink-soft">
          <p>{t('直接关闭会退出程序；最小化到托盘则让它在后台继续运行，点托盘图标就能回来。')}</p>
          <label className="mt-3 flex cursor-pointer select-none items-center gap-2 text-[12px] text-ink-soft">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 accent-seal"
            />
            {t('不再询问，以后都这样做')}
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => onDecide('cancel', false)}
            className="rounded-lg px-3.5 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            {t('取消')}
          </button>
          <button
            type="button"
            onClick={() => onDecide('close', remember)}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-1.5 text-[12px] text-ink-soft transition hover:border-line-strong hover:text-ink"
          >
            <Power size={13} />
            {t('直接关闭')}
          </button>
          <button
            type="button"
            onClick={() => onDecide('tray', remember)}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-[12px] font-medium text-paper shadow-sm transition hover:opacity-90"
          >
            <Minimize2 size={13} />
            {t('最小化到托盘')}
          </button>
        </div>
      </div>
    </ModalScrim>
  )
}

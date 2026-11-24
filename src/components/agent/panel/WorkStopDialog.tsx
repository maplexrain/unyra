/**
 * 终止 work 的确认框：把「强制终止」与「带声明终止」拆成两条明确的路。
 *
 * - 终止声明非空：关闭当前 loop 后，把声明作为 Work 通道消息发给 role，并激活 role；
 * - 终止声明为空：只允许强制终止，静默关闭 loop，不打扰 role。
 *
 * 删除是另一条链路（ConfirmDialog），不在这个框里把「删上下文」和「停一轮」混在一起。
 */
import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useEscapeKey } from '../../../lib/useEscape'
import { t } from '../../../i18n'
import ModalScrim from '../../ModalScrim'

export function WorkStopDialog({
  workName,
  onCancel,
  onForceStop,
  onStopWithStatement,
}: {
  workName: string
  onCancel: () => void
  onForceStop: () => void
  onStopWithStatement?: (statement: string) => void
}) {
  const [statement, setStatement] = useState('')
  useEscapeKey(onCancel)
  const canNotify = statement.trim().length > 0 && Boolean(onStopWithStatement)
  return (
    <ModalScrim z="z-[60]" onClose={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('终止 work「{0}」', workName)}
        className="w-full max-w-[560px] rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.3)] moji-dialog-in"
      >
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-seal/12 text-seal">
            <AlertTriangle size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-ink-strong">{t('终止 work「{0}」', workName)}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
              {t('带声明的终止会关闭 loop，并把声明发给 role、重新激活它；不写声明只能强制终止，role 不会收到消息。')}
            </p>
          </div>
          <button
            type="button"
            title={t('关闭')}
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5">
          <label className="mb-1.5 block text-[12px] font-medium text-ink-strong" htmlFor="work-stop-statement">
            {t('终止声明（可选）')}
          </label>
          <textarea
            id="work-stop-statement"
            data-work-stop-statement
            autoFocus
            rows={4}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder={t('例如：这个方向先停，保留已有材料；后续改从另一条线索继续。')}
            className="w-full resize-y rounded-xl border border-line bg-card px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/60 focus:ring-2 focus:ring-seal/10"
          />
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            {t('声明会作为一条 Work 通道消息进入 role 的上下文；强制终止不会。')}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[13px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            {t('取消')}
          </button>
          <button
            type="button"
            data-work-force-stop
            onClick={onForceStop}
            className="rounded-lg border border-line-strong bg-card px-4 py-2 text-[13px] font-medium text-ink transition hover:bg-line/50"
          >
            {t('强制终止')}
          </button>
          <button
            type="button"
            data-work-stop-notify
            disabled={!canNotify}
            onClick={() => onStopWithStatement?.(statement.trim())}
            className="rounded-lg bg-seal px-4 py-2 text-[13px] font-medium text-white shadow-sm transition hover:bg-seal-deep disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-faint"
          >
            {t('终止并通知 role')}
          </button>
        </div>
      </div>
    </ModalScrim>
  )
}

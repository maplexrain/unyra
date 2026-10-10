/**
 * 设置 → 窗口：关窗行为策略与托盘驻留控制。
 */

import { useEffect, useState } from 'react'
import {
  AppWindow,
  Check,
  HelpCircle,
  Minimize2,
  Sparkles,
  XCircle,
} from 'lucide-react'
import {
  CLOSE_BEHAVIORS,
  CLOSE_BEHAVIOR_HINT,
  CLOSE_BEHAVIOR_LABEL,
  closeBehavior,
  hideToTray,
  loadCloseBehavior,
  onCloseBehaviorChange,
  setCloseBehavior,
  type CloseBehavior,
} from '../../lib/closeBehavior'
import { pane } from '../Pane'
import { t } from '../../i18n'

const BEHAVIOR_ICONS: Record<CloseBehavior, typeof HelpCircle> = {
  ask: HelpCircle,
  close: XCircle,
  tray: Minimize2,
}

export function WindowPanel({ onToast }: { onToast: (msg: string) => void }) {
  const [behavior, setBehavior] = useState<CloseBehavior>(closeBehavior)

  useEffect(() => {
    let alive = true
    void loadCloseBehavior().then((v) => {
      if (alive) setBehavior(v)
    })
    const off = onCloseBehaviorChange(setBehavior)
    return () => {
      alive = false
      off()
    }
  }, [])

  const pick = (value: CloseBehavior) => {
    void setCloseBehavior(value).then((v) => {
      setBehavior(v)
      onToast(t('关闭窗口时：{0}', t(CLOSE_BEHAVIOR_LABEL[value])))
    })
  }

  return (
    <div className={pane(5, true)}>
      {/* 头部简介 */}
      <div className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <AppWindow size={16} className="text-seal" />
            <h2 className="text-[14px] font-semibold text-ink-strong">{t('窗口行为')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-soft">
            {t('管理应用窗口关闭行为与系统托盘后台驻留方式。')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-1 text-[11px] text-ok-deep">
          <Sparkles size={11} />
          <span>{t('全局设置 · 跟随机器')}</span>
        </div>
      </div>

      {/* 关闭窗口时的行为卡片组 */}
      <section className="flex flex-col gap-2.5">
        <div className="text-[13px] font-medium text-ink-strong">
          {t('关闭窗口时')}
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {CLOSE_BEHAVIORS.map((m) => {
            const isSelected = behavior === m
            const Icon = BEHAVIOR_ICONS[m]
            return (
              <button
                key={m}
                type="button"
                onClick={() => pick(m)}
                className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-seal/40 ${
                  isSelected
                    ? 'border-seal bg-seal/[0.04] shadow-sm ring-1 ring-seal/20'
                    : 'border-line bg-card hover:border-line-strong hover:bg-card/90'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-lg border ${
                        isSelected
                          ? 'border-seal/40 bg-seal/10 text-seal'
                          : 'border-line bg-paper text-ink-soft'
                      }`}
                    >
                      <Icon size={15} />
                    </div>
                    {isSelected && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-seal text-white shadow-xs">
                        <Check size={10} className="stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <div
                    className={`mt-2.5 text-[13px] font-semibold ${
                      isSelected ? 'text-seal-deep' : 'text-ink-strong'
                    }`}
                  >
                    {t(CLOSE_BEHAVIOR_LABEL[m])}
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
                  {t(CLOSE_BEHAVIOR_HINT[m])}
                </p>
              </button>
            )
          })}
        </div>
      </section>

      {/* 托盘快捷操作卡片 */}
      <section className="rounded-xl border border-line bg-card/60 p-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
              <Minimize2 size={15} />
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink-strong">{t('系统托盘控制')}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                {t(
                  '将窗口立即收进系统右下角托盘，应用将继续在后台运行。单击托盘图标即可随时唤醒展开，右键可选择完全退出。'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={hideToTray}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80"
          >
            <Minimize2 size={13} className="text-seal" />
            <span>{t('收进托盘')}</span>
          </button>
        </div>
      </section>

      {/* 底部自动保存说明 */}
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-card/50 px-3 py-2 text-[11px] text-ink-soft">
        <Check size={12} className="text-ok-deep stroke-[2.5]" />
        <span>{t('关窗行为改动即时生效并保存在这台机器上，重启应用设置依然保留。')}</span>
      </div>
    </div>
  )
}

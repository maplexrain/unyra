/**
 * 这个文件负责：「窗口」分页：关窗行为 + 托盘。
 */

import { useEffect, useState } from 'react'
import { Minimize2 } from 'lucide-react'
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

/* ---------- 窗口分页 ---------- */

/**
 * 「窗口」分页：关窗行为 + 托盘。
 *
 * 这两件事都是**全局**设置——跟机器走，不属于任何用户（与「存储」同理），
 * 因此存在 appdata 的 global.yaml 里，由主进程读写（见 electron/storage.ts）。
 * 这一页只负责显示与改值：真正拦下关窗、真正把窗口收进托盘的都在主进程。
 */
export function WindowPanel({ onToast }: { onToast: (msg: string) => void }) {
  const [behavior, setBehavior] = useState<CloseBehavior>(closeBehavior)

  /**
   * 打开面板时读一次主进程里的当前值；同时订阅变化——
   * 面板开着的时候可能正好关了一次窗，并在弹窗里勾了「不再询问」，
   * 那个选择也要立刻反映到这一页上。
   */
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
      onToast(t('关闭窗口时：{0}', t(CLOSE_BEHAVIOR_LABEL[v])))
    })
  }

  return (
    <div className={pane(5, true)}>
      <section>
        <div className="mb-2 text-ink-soft">{t('关闭窗口时')}</div>
        <div className="flex flex-wrap gap-2">
          {CLOSE_BEHAVIORS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => pick(m)}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition ${
                behavior === m
                  ? 'border-seal/50 bg-seal/10 font-medium text-seal-deep'
                  : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'
              }`}
            >
              {t(CLOSE_BEHAVIOR_LABEL[m])}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{t(CLOSE_BEHAVIOR_HINT[behavior])}</p>
      </section>

      <section>
        <div className="mb-2 text-ink-soft">{t('托盘')}</div>
        <button
          type="button"
          onClick={hideToTray}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
        >
          <Minimize2 size={13} />
          {t('现在收进托盘')}
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {t('窗口收进托盘后程序继续在后台运行：点托盘图标重新打开，右键菜单里可以退出。第一次收起来时会有一个气泡提示。')}
        </p>
      </section>

      <div className="rounded-lg border border-line bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        {t('关窗行为改动即时生效并记在这台机器上，重开应用也还在。')}
      </div>
    </div>
  )
}

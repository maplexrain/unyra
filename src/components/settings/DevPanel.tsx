/**
 * 这个文件负责：「开发者」分页：口令解锁与打开开发者工具。
 */

import { useState } from 'react'
import { Bell, Bug, Terminal } from 'lucide-react'
import { isDevUnlocked } from '../../lib/devMode'
import { native } from '../../lib/native'
import DevUnlock from '../DevUnlock'
import { pane } from '../Pane'
import { t } from '../../i18n'
import { inputBase } from './fields'

/* ---------- 开发者分页 ---------- */

/**
 * 「开发者」分页：目前只有一件事——打开开发者工具。
 *
 * 平时它藏在三击「设置」之后；解锁一次就把凭据（口令摘要，不是口令）写进
 * localStorage，之后打开设置直接就有这一页。校验只比摘要，见 lib/devMode。
 */
export function DevPanel({ onUnlocked }: { onUnlocked: () => void }) {
  const [unlocked, setUnlocked] = useState(isDevUnlocked)
  /** 系统通知测试的回执：null = 还没发过。守卫的分心警告走同一条链路，这里亮不亮就是那条链路的实况 */
  const [notifyResult, setNotifyResult] = useState<{ ok: boolean; text: string } | null>(null)

  /** 发一条真通知并把回执显示出来：notify 返回 {ok,error}，抛错（没桥）也要接住展示 */
  const sendTestNotify = () => {
    try {
      void native()
        .window.notify({ title: t('归一通知测试'), body: t('这是一条测试通知：看到它，说明系统通知链路是通的。') })
        .then((r) => {
          setNotifyResult(
            r.ok
              ? {
                  ok: true,
                  text: t(
                    '系统已受理这条通知。屏幕上没看到的话，多半是 Windows 的专注助手（勿扰）或系统通知设置把它静默压掉了。',
                  ),
                }
              : { ok: false, text: r.error ?? t('未知错误') },
          )
        })
    } catch (err) {
      setNotifyResult({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  }

  if (!unlocked) {
    return (
      <div className={pane(4, true)}>
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-ink-soft">
            <Terminal size={13} className="text-seal" />
            {t('开发者模式')}
          </div>
          <p className="mb-3 text-[11.5px] leading-relaxed text-ink-faint">
            {t('这一页平时不显示。输入口令解锁，解锁后会记住，之后打开设置直接可见。')}
          </p>
          <DevUnlock
            inputClass={`${inputBase} w-[240px] font-mono`}
            onUnlocked={() => {
              setUnlocked(true)
              onUnlocked()
            }}
          />
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            {t('程序里只保存口令的 SHA-256 摘要，校验时把输入折成摘要再比对；解锁凭据存在 localStorage，打开设置时自动读取。')}
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className={pane(4, true)}>
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-ink-soft">
          <Terminal size={13} className="text-seal" />
          {t('开发者工具')}
        </div>
        <button
          type="button"
          onClick={() => native().window.devtools()}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
        >
          <Bug size={14} />
          {t('打开开发者工具')}
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {t('已经开着的话会先关掉再打开，保证它显示在最上层。')}
        </p>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-1.5 text-ink-soft">
          <Bell size={13} className="text-seal" />
          {t('系统通知')}
        </div>
        <button
          type="button"
          onClick={sendTestNotify}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
        >
          <Bell size={14} />
          {t('发送测试通知')}
        </button>
        {notifyResult ? (
          <p className={'mt-2 text-[11px] leading-relaxed ' + (notifyResult.ok ? 'text-ink-faint' : 'text-warn-deep')}>
            {notifyResult.text}
          </p>
        ) : (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            {t('守卫的分心警告与隐私熔断走同一条链路：这里亮不亮，就是那条链路的实况。')}
          </p>
        )}
      </section>
    </div>
  )
}

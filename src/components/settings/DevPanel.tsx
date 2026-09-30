/**
 * 这个文件负责：「开发者」分页：口令解锁与打开开发者工具。
 */

import { useState } from 'react'
import { Bug, Terminal } from 'lucide-react'
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
    </div>
  )
}

/**
 * 这个模块为什么存在：开发者口令解锁那一段（口令输入框 + 「解锁」键 + 「口令不正确」提示）
 * 在超级导师设置与全局设置的开发者分页里各写了一遍，连按钮类名都逐字相同，抽在这里。
 *
 * 两处调用点的外壳（面板容器、说明文字、解锁后的内容）各不相同，留在各自那里；
 * 这里只管口令的输入与提交，凭据与校验仍走 lib/devMode 那一份。
 */
import { useState } from 'react'
import { unlockDevMode } from '../lib/devMode'
import { NO_AUTOFILL_SECRET } from '../lib/autofill'
import { t } from '../i18n'

interface Props {
  /** 输入框的类名：两处写法不同（一处是一整串字面量、一处由 settings/fields 的 inputBase 拼出），原样传进来 */
  inputClass: string
  /** 口令校验通过：解锁后显示什么由调用方决定 */
  onUnlocked: () => void
}

export default function DevUnlock({ inputClass, onUnlocked }: Props) {
  const [password, setPassword] = useState('')
  const [failed, setFailed] = useState(false)
  const submit = () => {
    if (!password) return
    if (!unlockDevMode(password)) {
      setFailed(true)
      setPassword('')
      return
    }
    setFailed(false)
    setPassword('')
    onUnlocked()
  }
  return (
    <>
      <div className="flex items-center gap-2">
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setFailed(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={t('口令')}
          spellCheck={false}
          className={inputClass}
          {...NO_AUTOFILL_SECRET}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!password}
          className="rounded-lg bg-ink px-3.5 py-1.5 text-[12px] font-medium text-paper shadow-sm transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-40"
        >
          {t('解锁')}
        </button>
      </div>
      {failed && <p className="mt-2 text-[11.5px] text-seal-deep">{t('口令不正确')}</p>}
    </>
  )
}

/**
 * 这个文件负责：带「显示 / 隐藏」眼睛按钮的密钥输入框（API Key 等处共用）。
 */

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { NO_AUTOFILL_SECRET } from '../../lib/autofill'
import { t } from '../../i18n'
import { inputBase } from './fields'

export function KeyField({
  id,
  value,
  onChange,
  onBlur,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex items-center gap-1.5">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="sk-…"
        spellCheck={false}
        className={`${inputBase} flex-1 font-mono`}
        {...NO_AUTOFILL_SECRET}
      />
      <button
        type="button"
        title={show ? t('隐藏') : t('显示')}
        onClick={() => setShow((v) => !v)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-ink-soft transition hover:text-ink"
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

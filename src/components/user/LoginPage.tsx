import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, KeyRound, Plus } from 'lucide-react'
import type { User, UserProfile } from '../../user/types'
import { displayName } from '../../user/profile'
import UserAvatar from '../user/UserAvatar'
import Bullseye from '../Bullseye'
import Logo from '../Logo'
import { t, LOCALES, LOCALE_LABEL, useLocale } from '../../i18n'
import { changeUiLocale } from '../../lib/uiLocale'
import { NO_AUTOFILL, NO_AUTOFILL_SECRET } from '../../lib/autofill'

interface Props {
  users: User[]
  /** 用某个已有用户登录 */
  onSignIn: (userId: string) => void
  /** 新建用户并登录（首次使用走这条）；apiKey 可选，配了才能让超级导师工作 */
  onCreate: (profile?: Partial<UserProfile>, apiKey?: string) => void | Promise<unknown>
  /** 提示信息（如登录失败） */
  hint?: string
}

/**
 * 登录页：未登录时唯一的可达页面。
 *
 * 本地实现下「登录」就是从本机已有用户里选一个，或用新用户开启。
 * 没有密码——数据都在同一台浏览器里，假密码只会制造安全错觉。
 * 接入真实账号体系时，这里换成账号密码 / 第三方登录即可，其余逻辑不用动。
 */
export default function LoginPage({ users, onSignIn, onCreate, hint }: Props) {
  const [creating, setCreating] = useState(users.length === 0)
  const [nickname, setNickname] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  // 界面语言是全局设置（跟机器走）：登录页就能切，不必先登录进设置
  const locale = useLocale()

  const submitNew = () => {
    const name = nickname.trim()
    if (!name) return
    void onCreate({ nickname: name }, apiKey.trim() || undefined)
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto bg-paper-deep px-6 py-10">
      <div className="w-full max-w-[420px]">
        <div className="flex items-center gap-3">
          <Logo size={48} />
          <div className="leading-tight">
            <div className="text-[20px] font-semibold text-ink-strong">{t('归一')}</div>
            <div className="text-[9.5px] uppercase tracking-[0.28em] text-ink-faint">
              Unyra · Retro Learning
            </div>
          </div>
          <div className="ml-auto flex gap-1">
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => changeUiLocale(l)}
                className={`rounded-lg border px-2 py-1 text-[11px] transition ${
                  locale === l
                    ? 'border-seal/50 bg-seal/10 font-medium text-seal-deep'
                    : 'border-line bg-card text-ink-faint hover:text-ink-soft'
                }`}
              >
                {LOCALE_LABEL[l]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 text-ink-soft">
          <Bullseye size={15} className="text-seal" />
          <p className="text-[13px] leading-relaxed">
            {t('登录后开始你的探索式学习。学习目标、知识节点与对话记录按用户分别保存。')}
          </p>
        </div>

        {hint && (
          <div className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn-deep">
            {hint}
          </div>
        )}

        {!creating && users.length > 0 && (
          <>
            <div className="mt-6 mb-2 text-[12px] text-ink-faint">{t('选择一个用户登录')}</div>
            <div className="flex flex-col gap-2">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onSignIn(u.id)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-line bg-card px-3 py-2.5 text-left transition hover:border-seal/40 hover:shadow-sm"
                >
                  <UserAvatar profile={u.profile} seed={u.id} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink-strong">
                      {displayName(u.profile)}
                    </span>
                    {(u.profile.role || u.profile.major) && (
                      <span className="mt-0.5 block truncate text-[11.5px] text-ink-faint">
                        {[u.profile.role, u.profile.major].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <ArrowRight
                    size={15}
                    className="shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-seal"
                  />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong py-2.5 text-[12.5px] text-ink-soft transition hover:border-seal/50 hover:text-seal-deep"
            >
              <Plus size={14} /> {t('新建用户')}
            </button>
          </>
        )}

        {(creating || users.length === 0) && (
          <div className="mt-6">
            <label htmlFor="moji-login-nickname" className="mb-1.5 block text-[12px] text-ink-soft">
              {t('昵称')}
            </label>
            <input
              id="moji-login-nickname"
              value={nickname}
              autoFocus
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNew()
              }}
              placeholder={t('例如：小明')}
              className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-[13px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/50 focus:ring-2 focus:ring-seal/12"
              {...NO_AUTOFILL}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              {t('登录后可在「用户」里补全画像，AI 会据此调整讲解。')}
            </p>

            <label htmlFor="moji-login-key" className="mt-4 mb-1.5 flex items-baseline gap-1.5 text-[12px] text-ink-soft">
              <KeyRound size={11} className="translate-y-px text-ink-faint" />
              AI API Key
              <span className="text-[10.5px] text-ink-faint">{t('选填，填了超级导师才能工作')}</span>
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="moji-login-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-xl border border-line bg-card px-3.5 py-2.5 font-mono text-[12.5px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/50 focus:ring-2 focus:ring-seal/12"
                {...NO_AUTOFILL_SECRET}
              />
              <button
                type="button"
                title={showKey ? t('隐藏') : t('显示')}
                onClick={() => setShowKey((v) => !v)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-card text-ink-soft transition hover:text-ink"
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              {t('选填。填了会为你创建一条 DeepSeek 官方提供商配置（含 deepseek-flash 模型）；不填就什么都不创建，之后可以在设置里自己添加任意提供商与模型。Key 仅保存在本机。')}
            </p>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={submitNew}
                disabled={!nickname.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-paper shadow-sm transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-40"
              >
                <ArrowRight size={14} /> {t('进入归一')}
              </button>
              {users.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false)
                    setNickname('')
                    setApiKey('')
                  }}
                  className="rounded-lg px-3 py-2 text-[12.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
                >
                  {t('返回')}
                </button>
              )}
            </div>
          </div>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-ink-faint">
          {t('目前是本地账号：用户与数据都只保存在这台浏览器里，不会上传。')}
        </p>
      </div>
    </div>
  )
}

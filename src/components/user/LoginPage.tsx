import { useState } from 'react'
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react'
import type { User, UserProfile } from '../../user/types'
import { displayName } from '../../user/profile'
import UserAvatar from '../user/UserAvatar'
import Bullseye from '../Bullseye'
import Logo from '../Logo'
import { t, LOCALES, LOCALE_LABEL, useLocale } from '../../i18n'
import { changeUiLocale } from '../../lib/uiLocale'
import { NO_AUTOFILL, NO_AUTOFILL_SECRET } from '../../lib/autofill'
import LoginBackgroundAnimation from './LoginBackgroundAnimation'

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
 * 重构优化后的现代设计：
 * - 柔和的环境光晕与微磨砂玻璃卡片（Backdrop Blur & Ambient Glow）
 * - 兼顾多用户快速选择与全新探索者创建的平滑分段切换（Segmented Switcher）
 * - 极具质感的输入框、API Key 保护与安全提示
 * - 严格遵循「本地优先」原则，清晰的数据隐私与多语言快切
 */
export default function LoginPage({ users, onSignIn, onCreate, hint }: Props) {
  const [creating, setCreating] = useState(users.length === 0)
  const [nickname, setNickname] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const locale = useLocale()

  const submitNew = async () => {
    const name = nickname.trim()
    if (!name || loading) return
    setLoading(true)
    try {
      await onCreate({ nickname: name }, apiKey.trim() || undefined)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto bg-paper-deep px-4 py-8 sm:px-6">
      {/* 炫酷浑天星盘与知识星络动态背景 */}
      <LoginBackgroundAnimation />

      {/* 背景柔和氛围光晕 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-seal/10 blur-[90px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-seal-deep/10 blur-[100px]"
      />

      <div className="relative z-10 w-full max-w-[440px]">
        {/* 核心卡片容器 */}
        <div className="rounded-3xl border border-line-strong/60 bg-card/85 p-6 shadow-2xl backdrop-blur-2xl transition-all sm:p-8">
          {/* 顶栏：品牌标识与语言切换 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-paper/60 shadow-xs">
                <Logo size={32} />
              </div>
              <div className="leading-tight">
                <div className="text-[18px] font-semibold tracking-tight text-ink-strong">
                  {t('归一')}
                </div>
                <div className="text-[9px] font-medium uppercase tracking-[0.22em] text-ink-faint">
                  Unyra · Retro Learning
                </div>
              </div>
            </div>

            {/* 多语言切换 */}
            <div className="flex items-center rounded-full border border-line/70 bg-paper/60 p-0.5 shadow-xs">
              {LOCALES.map((l) => {
                const active = locale === l
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => changeUiLocale(l)}
                    className={`rounded-full px-2.5 py-1 text-[11px] transition-all ${
                      active
                        ? 'bg-card font-medium text-ink-strong shadow-xs'
                        : 'text-ink-faint hover:text-ink-soft'
                    }`}
                  >
                    {LOCALE_LABEL[l]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 理念描述 */}
          <div className="mt-5 rounded-2xl border border-line/60 bg-paper/40 p-3 text-[12.5px] leading-relaxed text-ink-soft">
            <div className="flex items-start gap-2">
              <Bullseye size={14} className="mt-0.5 shrink-0 text-seal" />
              <span>
                {t('登录后开始你的探索式学习。学习目标、知识节点与对话记录按用户分别保存。')}
              </span>
            </div>
          </div>

          {/* 提示/错误条 */}
          {hint && (
            <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12px] font-medium text-warn-deep shadow-xs">
              {hint}
            </div>
          )}

          {/* 分段模式切换（当已有本地用户时显示） */}
          {users.length > 0 && (
            <div className="mt-6 flex rounded-xl border border-line bg-paper/60 p-1">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-medium transition-all ${
                  !creating
                    ? 'bg-card text-ink-strong shadow-xs'
                    : 'text-ink-faint hover:text-ink-soft'
                }`}
              >
                <Users size={13} className={!creating ? 'text-seal' : 'text-ink-faint'} />
                <span>
                  {t('选择已有用户')} ({users.length})
                </span>
              </button>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-medium transition-all ${
                  creating
                    ? 'bg-card text-ink-strong shadow-xs'
                    : 'text-ink-faint hover:text-ink-soft'
                }`}
              >
                <UserPlus size={13} className={creating ? 'text-seal' : 'text-ink-faint'} />
                <span>{t('新建探索者')}</span>
              </button>
            </div>
          )}

          {/* 用户列表区 */}
          {!creating && users.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[11.5px] font-medium tracking-wide text-ink-faint">
                {t('选择一个用户登录')}
              </div>
              <div className="max-h-[260px] space-y-2 overflow-y-auto pr-0.5">
                {users.map((u) => {
                  const sub = [u.profile.role, u.profile.major].filter(Boolean).join(' · ')
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => onSignIn(u.id)}
                      className="group flex w-full items-center gap-3.5 rounded-2xl border border-line/70 bg-paper/40 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-seal/50 hover:bg-card hover:shadow-sm active:translate-y-0"
                    >
                      <UserAvatar
                        profile={u.profile}
                        seed={u.id}
                        size={38}
                        className="ring-2 ring-line-strong/40"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-ink-strong group-hover:text-seal-deep">
                          {displayName(u.profile)}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-ink-faint">
                          {sub || t('探索者')}
                        </span>
                      </span>
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-line/40 text-ink-faint transition-all group-hover:bg-seal group-hover:text-paper group-hover:shadow-xs">
                        <ArrowRight
                          size={13}
                          className="transition-transform group-hover:translate-x-0.5"
                        />
                      </div>
                    </button>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong/70 py-2.5 text-[12.5px] font-medium text-ink-soft transition-all hover:border-seal/60 hover:bg-seal/5 hover:text-seal-deep"
              >
                <Plus size={14} /> {t('新建用户')}
              </button>
            </div>
          )}

          {/* 新建用户表单 */}
          {(creating || users.length === 0) && (
            <div className="mt-5">
              <div className="mb-4 flex items-center gap-1.5 text-[13px] font-medium text-ink-strong">
                <Sparkles size={14} className="text-seal" />
                <span>{users.length === 0 ? t('创建初始探索者') : t('开启新的探索旅程')}</span>
              </div>

              <div>
                <label
                  htmlFor="moji-login-nickname"
                  className="mb-1.5 block text-[12px] font-medium text-ink-soft"
                >
                  {t('昵称')}
                </label>
                <input
                  id="moji-login-nickname"
                  value={nickname}
                  autoFocus
                  onChange={(e) => setNickname(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitNew()
                  }}
                  placeholder={t('例如：小明')}
                  className="w-full rounded-xl border border-line-strong/60 bg-paper/50 px-3.5 py-2.5 text-[13px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal focus:bg-card focus:ring-4 focus:ring-seal/10"
                  {...NO_AUTOFILL}
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                  {t('登录后可在「用户」里补全画像，AI 会据此调整讲解。')}
                </p>
              </div>

              <div className="mt-4">
                <label
                  htmlFor="moji-login-key"
                  className="mb-1.5 flex items-baseline justify-between text-[12px] font-medium text-ink-soft"
                >
                  <span className="flex items-center gap-1.5">
                    <KeyRound size={12} className="text-seal" />
                    <span>AI API Key</span>
                  </span>
                  <span className="text-[10.5px] font-normal text-ink-faint">
                    {t('选填，填了超级导师才能工作')}
                  </span>
                </label>
                <div className="relative flex items-center">
                  <input
                    id="moji-login-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-…"
                    spellCheck={false}
                    className="w-full rounded-xl border border-line-strong/60 bg-paper/50 py-2.5 pr-11 pl-3.5 font-mono text-[12.5px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal focus:bg-card focus:ring-4 focus:ring-seal/10"
                    {...NO_AUTOFILL_SECRET}
                  />
                  <button
                    type="button"
                    title={showKey ? t('隐藏') : t('显示')}
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2.5 flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/40 hover:text-ink"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                  {t('选填。填了会为你创建一条 DeepSeek 官方提供商配置（含 deepseek-flash 模型）；不填就什么都不创建，之后可以在设置里自己添加任意提供商与模型。Key 仅保存在本机。')}
                </p>
              </div>

              <div className="mt-6 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void submitNew()}
                  disabled={!nickname.trim() || loading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-[13.5px] font-medium text-paper shadow-md transition-all hover:bg-ink-strong hover:shadow-lg active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
                >
                  <ArrowRight size={14} />
                  <span>{t('进入归一')}</span>
                </button>

                {users.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false)
                      setNickname('')
                      setApiKey('')
                    }}
                    className="rounded-xl border border-line px-4 py-2.5 text-[12.5px] font-medium text-ink-soft transition hover:bg-line/50 hover:text-ink"
                  >
                    {t('返回')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 底部本地优先与隐私保障声明 */}
          <div className="mt-6 flex items-center justify-center gap-1.5 border-t border-line/60 pt-4 text-[11px] text-ink-faint">
            <ShieldCheck size={13} className="shrink-0 text-seal/80" />
            <span>{t('目前是本地账号：用户与数据都只保存在这台浏览器里，不会上传。')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

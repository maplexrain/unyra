import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  Plus,
  Save,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import {
  EDUCATION_OPTIONS,
  GENDER_LABEL,
  GENDER_OPTIONS,
  LANGUAGE_OPTIONS,
  ROLE_OPTIONS,
  emptyProfile,
  type Gender,
  type User,
  type UserProfile,
} from '../../user/types'
import { displayName } from '../../user/profile'
import { saveAvatarFile } from '../../user/avatar'
import { NO_AUTOFILL, NO_AUTOFILL_SECRET } from '../../lib/autofill'
import { t } from '../../i18n'
import ConfirmDialog from '../ConfirmDialog'
import UserAvatar from './UserAvatar'
import {
  IconAge,
  IconEducation,
  IconExperience,
  IconGender,
  IconLanguage,
  IconMajor,
  IconRole,
  IconShield,
  IconSkills,
  IconSparkles,
  IconUserNickname,
} from './UserIcons'

export interface UserTabPaneProps {
  users: User[]
  activeUserId: string | null
  onSelect: (userId: string) => void
  onCreate: (profile?: Partial<UserProfile>, apiKey?: string) => Promise<User> | void
  onUpdate: (userId: string, patch: Partial<UserProfile>) => void
  onDelete: (userId: string) => void
  onSignOut: () => void
  onToast: (msg: string) => void
}

const INPUT_CLASS =
  'w-full rounded-lg border border-line/70 bg-card/60 px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal focus:bg-card focus:ring-1 focus:ring-seal/30'

export default function UserTabPane({
  users,
  activeUserId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onSignOut,
  onToast,
}: UserTabPaneProps) {
  const [editingId, setEditingId] = useState<string>(activeUserId ?? users[0]?.id ?? '')
  const [draft, setDraft] = useState<UserProfile>(() => {
    const u = users.find((x) => x.id === activeUserId) ?? users[0]
    return { ...emptyProfile(), ...(u?.profile ?? {}) }
  })
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<User | null>(null)

  // 新建用户面板展开态
  const [newOpen, setNewOpen] = useState(false)
  const [newNickname, setNewNickname] = useState('')
  const [newKey, setNewKey] = useState('')
  const [showNewKey, setShowNewKey] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // 保证 editingId 始终有效
  useEffect(() => {
    if (!users.some((u) => u.id === editingId) && users.length > 0) {
      const fallback = users.find((u) => u.id === activeUserId) ?? users[0]
      setEditingId(fallback.id)
      setDraft({ ...emptyProfile(), ...fallback.profile })
    }
  }, [users, editingId, activeUserId])

  const editing = users.find((u) => u.id === editingId) ?? users[0]
  const isActive = editing?.id === activeUserId
  const dirty = editing ? JSON.stringify(draft) !== JSON.stringify(editing.profile) : false

  const pickUser = (u: User) => {
    setEditingId(u.id)
    setDraft({ ...emptyProfile(), ...u.profile })
    setBusy(false)
  }

  const setField = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  const handleSave = () => {
    if (!editing) return
    onUpdate(editing.id, draft)
    onToast(t('用户资料已保存，导师讲解将据此定制'))
  }

  // Ctrl+S 快捷保存
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty) handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dirty, draft, editing])

  const uploadAvatar = async (file: File) => {
    setBusy(true)
    try {
      const avatar = await saveAvatarFile(file)
      setField('avatar', avatar)
      onToast(t('头像上传成功'))
    } catch (err) {
      onToast(err instanceof Error ? err.message : t('头像处理失败'))
    } finally {
      setBusy(false)
    }
  }

  const submitNewUser = async () => {
    const nickname = newNickname.trim()
    if (!nickname) return
    try {
      const created = await onCreate({ nickname }, newKey.trim() || undefined)
      onToast(t('已创建并切换到新用户'))
      setNewOpen(false)
      setNewNickname('')
      setNewKey('')
      setShowNewKey(false)
      if (created) pickUser(created)
    } catch (e) {
      onToast(e instanceof Error ? e.message : t('创建用户失败'))
    }
  }

  const copyUserId = () => {
    if (!editing) return
    navigator.clipboard.writeText(editing.id).then(() => {
      onToast(t('用户 ID 已复制到剪贴板'))
    })
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-paper selection:bg-seal/15">
      {/* 顶部 Hero Header 区 */}
      <header className="relative shrink-0 border-b border-line/70 bg-paper-deep/50 px-8 py-5 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="group relative">
              <UserAvatar
                profile={draft}
                seed={editing?.id}
                size={64}
                className="ring-2 ring-line-strong/60 shadow-sm transition group-hover:opacity-90"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                title={t('点击更换头像')}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 backdrop-blur-[2px] transition group-hover:opacity-100 disabled:opacity-0"
              >
                {busy ? <Loader2 size={18} className="animate-spin text-white" /> : <Upload size={18} className="text-white" />}
              </button>
              {isActive && (
                <span
                  title={t('当前登录会话')}
                  className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-paper bg-emerald-500 shadow-xs"
                />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-ink">
                  {displayName(draft, t('未命名用户'))}
                </h1>
                {isActive ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <UserCheck size={12} />
                    {t('当前用户')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (editing) {
                        onSelect(editing.id)
                        onToast(t('已切换到「{0}」', displayName(editing.profile)))
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-seal/40 bg-seal/10 px-2 py-0.5 text-[11px] font-medium text-seal-deep transition hover:bg-seal/20 cursor-pointer"
                  >
                    {t('切换到此用户')}
                  </button>
                )}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[12px] text-ink-soft">
                <button
                  type="button"
                  onClick={copyUserId}
                  title={t('点击复制 ID')}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] text-ink-faint transition hover:bg-line/60 hover:text-ink cursor-pointer"
                >
                  <Copy size={11} />
                  <span>ID: {editing?.id.slice(0, 12)}...</span>
                </button>
                {draft.role && <span className="rounded bg-line/50 px-2 py-0.5 text-[11.5px] text-ink-soft">{draft.role}</span>}
                {draft.major && <span className="rounded bg-line/50 px-2 py-0.5 text-[11.5px] text-ink-soft">{draft.major}</span>}
              </div>
            </div>
          </div>

          {/* 右侧动作按钮区 */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={!editing || !dirty}
              className="flex items-center gap-1.5 rounded-lg bg-seal px-3.5 py-2 text-[12.5px] font-medium text-white shadow-xs transition hover:bg-seal-deep active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
            >
              <Save size={14} />
              <span>{dirty ? t('保存修改') : t('已是最新')}</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              title={t('退出登录并返回登录界面')}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-card/60 px-3 py-2 text-[12.5px] font-medium text-ink-soft shadow-xs transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-900/60 dark:hover:bg-red-950/30 dark:hover:text-red-400 active:scale-[0.98] cursor-pointer"
            >
              <LogOut size={14} />
              <span>{t('退出登录')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* 主体双栏区域：左侧导航与右侧内容一体化展开，彻底消除失衡与厚重卡牌 */}
      <div className="mx-auto flex h-full w-full max-w-7xl flex-1 overflow-hidden">
        {/* 左侧栏：用户列表与切换 */}
        <aside className="flex w-72 shrink-0 flex-col justify-between border-r border-line/60 bg-paper-deep/20 p-5 lg:w-80">
          <div className="flex flex-col overflow-hidden">
            <div className="mb-3 flex items-center justify-between pb-2 border-b border-line/50">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <Users size={15} className="text-seal" />
                <span>{t('用户列表')}</span>
                <span className="rounded bg-line/80 px-1.5 py-0.2 font-mono text-[10.5px] text-ink-soft">
                  {users.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setNewOpen((v) => !v)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition cursor-pointer ${
                  newOpen
                    ? 'bg-seal/15 text-seal-deep'
                    : 'text-ink-soft hover:bg-line/60 hover:text-ink'
                }`}
              >
                <Plus size={13} />
                <span>{t('新建')}</span>
              </button>
            </div>

            {/* 新建用户轻量表单 */}
            {newOpen && (
              <div className="mb-3 rounded-lg border border-seal/30 bg-card p-3 shadow-xs animate-in fade-in">
                <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
                  <UserPlus size={13} className="text-seal" />
                  <span>{t('创建新用户')}</span>
                </div>
                <div className="space-y-2">
                  <input
                    value={newNickname}
                    autoFocus
                    onChange={(e) => setNewNickname(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitNewUser()
                    }}
                    placeholder={t('新用户昵称')}
                    className={INPUT_CLASS}
                    {...NO_AUTOFILL}
                  />
                  <div className="relative">
                    <input
                      type={showNewKey ? 'text' : 'password'}
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitNewUser()
                      }}
                      placeholder={t('API Key (选填)')}
                      spellCheck={false}
                      className={`${INPUT_CLASS} pr-8 font-mono text-[11px]`}
                      {...NO_AUTOFILL_SECRET}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink cursor-pointer"
                    >
                      {showNewKey ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
                <div className="mt-2.5 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNewOpen(false)
                      setNewNickname('')
                      setNewKey('')
                    }}
                    className="rounded px-2.5 py-1 text-[11.5px] text-ink-soft hover:bg-line/50 hover:text-ink cursor-pointer"
                  >
                    {t('取消')}
                  </button>
                  <button
                    type="button"
                    onClick={submitNewUser}
                    disabled={!newNickname.trim()}
                    className="flex items-center gap-1 rounded bg-seal px-2.5 py-1 text-[11.5px] font-medium text-white shadow-xs hover:bg-seal-deep disabled:opacity-40 cursor-pointer"
                  >
                    <Check size={12} />
                    <span>{t('创建')}</span>
                  </button>
                </div>
              </div>
            )}

            {/* 用户列表条目 */}
            <div className="space-y-1 overflow-y-auto pr-0.5">
              {users.map((u) => {
                const isSelected = u.id === editing?.id
                const isCurrentSession = u.id === activeUserId
                return (
                  <div
                    key={u.id}
                    onClick={() => pickUser(u)}
                    className={`group relative flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-all ${
                      isSelected
                        ? 'bg-seal/10 text-ink shadow-2xs border-l-3 border-seal pl-2'
                        : 'hover:bg-line/40 text-ink-soft hover:text-ink'
                    }`}
                  >
                    <UserAvatar profile={u.profile} seed={u.id} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`truncate text-[13px] ${isSelected ? 'font-semibold text-ink' : 'font-medium'}`}>
                          {displayName(u.profile)}
                        </span>
                        {isCurrentSession && (
                          <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.1 font-mono text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                            {t('当前')}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-ink-faint">
                        {[u.profile.role, u.profile.major].filter(Boolean).join(' · ') || t('未设置角色')}
                      </div>
                    </div>

                    {!isCurrentSession && (
                      <button
                        type="button"
                        title={t('快速切换')}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect(u.id)
                          onToast(t('已切换到「{0}」', displayName(u.profile)))
                        }}
                        className="rounded border border-line bg-paper px-1.5 py-0.5 text-[10.5px] text-ink-soft opacity-0 shadow-2xs transition group-hover:opacity-100 hover:border-seal/50 hover:text-seal-deep cursor-pointer"
                      >
                        {t('切换')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-4 border-t border-line/40 pt-3 text-[11px] leading-relaxed text-ink-faint">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-ink-soft">
              <IconShield className="h-3.5 w-3.5 text-seal" />
              <span>{t('本地数据隔离')}</span>
            </div>
            {t('每个用户的学习目标、知识图谱、做题记录与导师对话均完全隔离保存在本设备。')}
          </div>
        </aside>

        {/* 右侧：用户信息与学习画像表单，摒弃圆角卡牌，采用流式工整工作台设计 */}
        <main className="flex-1 overflow-y-auto px-8 py-7">
          <div className="max-w-3xl space-y-8">
            {/* 1. 基本信息区域 */}
            <section>
              <div className="mb-4 flex items-center justify-between border-b border-line/60 pb-2.5">
                <div className="flex items-center gap-2">
                  <IconUserNickname className="h-4.5 w-4.5 text-seal" />
                  <h2 className="text-[14.5px] font-bold text-ink">{t('基本资料')}</h2>
                </div>
                <span className="text-[11.5px] text-ink-faint">{t('个人在界面中的展示基础')}</span>
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field icon={<IconUserNickname className="h-3.5 w-3.5 text-seal" />} label={t('用户昵称')} hint={t('称谓')}>
                  <input
                    value={draft.nickname}
                    onChange={(e) => setField('nickname', e.target.value)}
                    placeholder={t('如：Maxwell')}
                    className={INPUT_CLASS}
                    {...NO_AUTOFILL}
                  />
                </Field>

                <Field icon={<IconAge className="h-3.5 w-3.5 text-seal" />} label={t('年龄')}>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={draft.age ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setField('age', v === '' ? null : Number(v))
                    }}
                    placeholder={t('选填')}
                    className={INPUT_CLASS}
                    {...NO_AUTOFILL}
                  />
                </Field>

                <Field icon={<IconGender className="h-3.5 w-3.5 text-seal" />} label={t('性别')}>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {GENDER_OPTIONS.map((g: Gender) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setField('gender', g)}
                        className={`rounded-md border px-2.5 py-1.5 text-[11.5px] transition cursor-pointer ${
                          draft.gender === g
                            ? 'border-seal/60 bg-seal/10 font-semibold text-seal-deep shadow-2xs'
                            : 'border-line/70 bg-card/40 text-ink-soft hover:bg-line/40 hover:text-ink'
                        }`}
                      >
                        {t(GENDER_LABEL[g])}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field icon={<IconLanguage className="h-3.5 w-3.5 text-seal" />} label={t('讲解语言')} hint={t('AI 导师优先交流语言')}>
                  <input
                    list="user-tab-languages"
                    value={draft.language}
                    onChange={(e) => setField('language', e.target.value)}
                    placeholder={t('如：中文')}
                    className={INPUT_CLASS}
                    {...NO_AUTOFILL}
                  />
                  <datalist id="user-tab-languages">
                    {LANGUAGE_OPTIONS.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                </Field>
              </div>
            </section>

            {/* 2. 学习画像与超级导师定制 */}
            <section>
              <div className="mb-4 flex items-center justify-between border-b border-line/60 pb-2.5">
                <div className="flex items-center gap-2">
                  <IconSparkles className="h-4.5 w-4.5 text-amber-500" />
                  <h2 className="text-[14.5px] font-bold text-ink">{t('学习画像与导师定制')}</h2>
                </div>
                <span className="flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  <IconEducation className="h-3 w-3" />
                  {t('动态对齐理解能力')}
                </span>
              </div>

              <div className="mb-4 border-l-2 border-amber-500/50 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
                {t('超级导师将结合下方画像定制讲解深度与举例场景。背景与已有经验越详实，知识点讲解越直观深入。')}
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field icon={<IconRole className="h-3.5 w-3.5 text-seal" />} label={t('当前角色 / 身份')}>
                  <input
                    list="user-tab-roles"
                    value={draft.role}
                    onChange={(e) => setField('role', e.target.value)}
                    placeholder={t('如：全栈工程师 / 高中生 / 研究员')}
                    className={INPUT_CLASS}
                    {...NO_AUTOFILL}
                  />
                  <datalist id="user-tab-roles">
                    {ROLE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {t(o)}
                      </option>
                    ))}
                  </datalist>
                </Field>

                <Field icon={<IconEducation className="h-3.5 w-3.5 text-seal" />} label={t('教育程度')}>
                  <input
                    list="user-tab-educations"
                    value={draft.education}
                    onChange={(e) => setField('education', e.target.value)}
                    placeholder={t('如：本科 / 硕士')}
                    className={INPUT_CLASS}
                    {...NO_AUTOFILL}
                  />
                  <datalist id="user-tab-educations">
                    {EDUCATION_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {t(o)}
                      </option>
                    ))}
                  </datalist>
                </Field>

                <div className="sm:col-span-2">
                  <Field icon={<IconMajor className="h-3.5 w-3.5 text-seal" />} label={t('专业领域 / 核心方向')}>
                    <input
                      value={draft.major}
                      onChange={(e) => setField('major', e.target.value)}
                      placeholder={t('如：计算机科学与技术 / 理论物理 / 金融学')}
                      className={INPUT_CLASS}
                      {...NO_AUTOFILL}
                    />
                  </Field>
                </div>

                <div className="sm:col-span-2">
                  <Field
                    icon={<IconExperience className="h-3.5 w-3.5 text-seal" />}
                    label={t('学习与实践经历')}
                    hint={t('帮助导师举出贴近你实际工作生活的生动例子')}
                  >
                    <textarea
                      rows={3}
                      value={draft.experience}
                      onChange={(e) => setField('experience', e.target.value)}
                      placeholder={t('如：3 年前端开发经验，对底层渲染机制感兴趣，目前在自学 Rust 与计算机体系结构')}
                      className={`${INPUT_CLASS} resize-y leading-relaxed`}
                      {...NO_AUTOFILL}
                    />
                  </Field>
                </div>

                <div className="sm:col-span-2">
                  <Field
                    icon={<IconSkills className="h-3.5 w-3.5 text-seal" />}
                    label={t('已掌握的技能')}
                    hint={t('用逗号分隔，避免导师重复解释基础概念')}
                  >
                    <textarea
                      rows={2}
                      value={draft.skills}
                      onChange={(e) => setField('skills', e.target.value)}
                      placeholder={t('如：JavaScript, React, Node.js, Git, Linux')}
                      className={`${INPUT_CLASS} resize-y leading-relaxed`}
                      {...NO_AUTOFILL}
                    />
                  </Field>
                </div>
              </div>
            </section>

            {/* 3. 危险区域 */}
            <section className="border-t border-line/60 pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-[13.5px] font-semibold text-red-600 dark:text-red-400">{t('危险区域')}</h3>
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">
                    {t('删除用户将彻底清空该用户的全部目标、知识图谱与对话数据，且无法恢复。')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={users.length <= 1}
                  title={users.length <= 1 ? t('至少保留一个用户') : t('删除该用户')}
                  onClick={() => setPendingDelete(editing)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-300/80 bg-red-50/40 px-3 py-1.5 text-[12px] font-medium text-red-600 transition hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/40 disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
                >
                  <Trash2 size={13} />
                  <span>{t('删除此用户')}</span>
                </button>
              </div>
            </section>
          </div>
        </main>
      </div>

      {/* 隐藏的头像文件上传 input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void uploadAvatar(f)
          e.target.value = ''
        }}
      />

      {/* 删除二次确认弹窗 */}
      {pendingDelete && (
        <ConfirmDialog
          title={t('确认删除用户？')}
          message={t(
            '「{0}」的学习目标、对话记录与个人画像都将被永久移除。此操作不可逆，请确认。',
            displayName(pendingDelete.profile)
          )}
          confirmLabel={t('确认删除')}
          onConfirm={() => {
            onDelete(pendingDelete.id)
            setPendingDelete(null)
            onToast(t('用户已被删除'))
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

function Field({
  icon,
  label,
  hint,
  children,
}: {
  icon?: ReactNode
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft">
          {icon}
          <span>{label}</span>
        </span>
        {hint && <span className="text-[10.5px] text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

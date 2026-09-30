import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Eye, EyeOff, Loader2, LogOut, Plus, Trash2, Upload, UserRound, Users, X } from 'lucide-react'
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
import { readAvatarFile } from '../../user/avatar'
import { NO_AUTOFILL, NO_AUTOFILL_SECRET } from '../../lib/autofill'
import { useLeaving } from '../../lib/presence'
import { t } from '../../i18n'
import ConfirmDialog from '../ConfirmDialog'
import ModalScrim from '../ModalScrim'
import UserAvatar from './UserAvatar'

interface Props {
  users: User[]
  activeUserId: string | null
  onClose: () => void
  /** 切换当前用户：由 App 负责切换作用域并重载该用户的数据 */
  onSelect: (userId: string) => void
  /** 新建用户（并切到它）；apiKey 可选。返回新用户，便于表单切过去编辑 */
  onCreate: (profile?: Partial<UserProfile>, apiKey?: string) => Promise<User> | void
  /** 保存某个用户的画像 */
  onUpdate: (userId: string, patch: Partial<UserProfile>) => void
  /** 删除某个用户 */
  onDelete: (userId: string) => void
  /** 退出登录 */
  onSignOut: () => void
  onToast: (msg: string) => void
}

const FIELD =
  'w-full rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/60 focus:ring-2 focus:ring-seal/15'

/**
 * 用户管理：左侧用户列表（切换/新建/删除），右侧画像表单。
 *
 * 画像字段是导师**主动取**的那份资料（api.userInfo.get，见 user/fields），不再拼进系统提示词，
 * 因此分组呈现：「称呼」影响界面，其余影响教学定制（导师讲之前会读一遍，缺什么它自己问）；
 * 表单里对后者给出说明。
 * 所有存储改动都通过 props 交给 App，组件自身不直接落盘。
 */
export default function UserDialog({
  users,
  activeUserId,
  onClose,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onSignOut,
  onToast,
}: Props) {
  // 关闭路径（Esc / 点遮罩 / 两个关闭按钮）统一走 close，先播退场动画
  const { leaving, close } = useLeaving(onClose)
  const [editingId, setEditingId] = useState(activeUserId ?? users[0]?.id ?? '')
  const [draft, setDraft] = useState<UserProfile>(() => {
    const u = users.find((x) => x.id === activeUserId)
    return { ...emptyProfile(), ...(u?.profile ?? {}) }
  })
  const [busy, setBusy] = useState(false)
  // 删除不可恢复（文档与学习数据一并消失），先确认
  const [pendingDelete, setPendingDelete] = useState<User | null>(null)
  // 新建用户：展开一个小表单，可同时填入该用户的 API Key
  const [newOpen, setNewOpen] = useState(false)
  const [newNickname, setNewNickname] = useState('')
  const [newKey, setNewKey] = useState('')
  const [showNewKey, setShowNewKey] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 删除确认框自己处理 Escape，这里只在没有它时关闭
      if (e.key === 'Escape' && !pendingDelete) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, pendingDelete])

  // 当前正在编辑的用户；列表变化（删除）时回落到第一个
  const editing = users.find((u) => u.id === editingId) ?? users[0]
  const dirty = editing ? JSON.stringify(draft) !== JSON.stringify(editing.profile) : false
  const isActive = editing?.id === activeUserId

  const pick = (u: User) => {
    setEditingId(u.id)
    setDraft({ ...emptyProfile(), ...u.profile })
    setBusy(false)
  }

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const save = () => {
    if (!editing) return
    onUpdate(editing.id, draft)
    onToast(t('已保存，之后的讲解会据此调整'))
  }

  const uploadAvatar = async (file: File) => {
    setBusy(true)
    try {
      const avatar = await readAvatarFile(file)
      set('avatar', avatar)
    } catch (err) {
      onToast(err instanceof Error ? err.message : t('头像处理失败'))
    } finally {
      setBusy(false)
    }
  }

  /** 新建用户：昵称必填，API Key 选填（填了该用户才能用超级导师） */
  const submitNewUser = async () => {
    const nickname = newNickname.trim()
    if (!nickname) return
    const created = await onCreate({ nickname }, newKey.trim() || undefined)
    onToast(t('已新建用户并切换过去'))
    setNewOpen(false)
    setNewNickname('')
    setNewKey('')
    setShowNewKey(false)
    // 表单切到刚建的用户，避免停留在上一位的画像上
    if (created) pick(created)
  }

  return (
    <ModalScrim z="z-[60]" leaving={leaving} onClose={close}>
      <div
        role="dialog"
        aria-label={t('用户')}
        className={`flex h-[min(660px,90vh)] w-full max-w-4xl overflow-hidden rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.28)] ${
          leaving ? 'moji-dialog-out' : 'moji-dialog-in'
        }`}
      >
        {/* 左：用户列表 */}
        <nav className="flex w-[232px] shrink-0 flex-col border-r border-line bg-paper-deep">
          <div className="flex items-center justify-between px-3 pb-2 pt-4">
            <span className="flex items-center gap-2 text-[15px] font-semibold text-ink-strong">
              <Users size={16} className="shrink-0 text-seal" />
              {t('用户')}
            </span>
            <button
              type="button"
              title={t('新建用户')}
              onClick={() => setNewOpen((v) => !v)}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-line/70 hover:text-ink ${
                newOpen ? 'bg-line/70 text-ink' : 'text-ink-soft'
              }`}
            >
              <Plus size={16} />
            </button>
          </div>

          {newOpen && (
            <div className="mx-2 mb-2 rounded-lg border border-seal/30 bg-card px-2.5 py-2.5">
              <div className="mb-1.5 text-[11.5px] text-ink-soft">{t('新建用户')}</div>
              <input
                value={newNickname}
                autoFocus
                onChange={(e) => setNewNickname(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNewUser()
                }}
                placeholder={t('昵称')}
                className="w-full rounded-md border border-line bg-paper px-2 py-1.5 text-[12px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/50"
                {...NO_AUTOFILL}
              />
              <div className="mt-1.5 flex items-center gap-1">
                <input
                  type={showNewKey ? 'text' : 'password'}
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNewUser()
                  }}
                  placeholder={t('DeepSeek API Key（选填，填了就建一条 DeepSeek 提供商）')}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1.5 font-mono text-[11.5px] text-ink-strong outline-none transition placeholder:font-sans placeholder:text-ink-faint focus:border-seal/50"
                  {...NO_AUTOFILL_SECRET}
                />
                <button
                  type="button"
                  title={showNewKey ? t('隐藏') : t('显示')}
                  onClick={() => setShowNewKey((v) => !v)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:text-ink"
                >
                  {showNewKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
                {t('每位用户各自保存自己的 Key，稍后也可在设置里填写。')}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={submitNewUser}
                  disabled={!newNickname.trim()}
                  className="rounded-md bg-ink px-2.5 py-1.5 text-[11.5px] font-medium text-paper transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-40"
                >
                  {t('创建并切换')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewOpen(false)
                    setNewNickname('')
                    setNewKey('')
                  }}
                  className="rounded-md px-2 py-1.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
                >
                  {t('取消')}
                </button>
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {users.map((u) => {
              const active = u.id === editing?.id
              const inUse = u.id === activeUserId
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => pick(u)}
                  className={`mb-1 flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
                    active ? 'border-line-strong bg-card shadow-sm' : 'border-transparent hover:bg-line/40'
                  }`}
                >
                  <UserAvatar profile={u.profile} seed={u.id} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`truncate text-[13px] ${active ? 'font-semibold text-ink-strong' : 'font-medium text-ink'}`}
                      >
                        {displayName(u.profile)}
                      </span>
                      {inUse && (
                        <span className="shrink-0 rounded bg-seal/10 px-1 py-px text-[9.5px] text-seal-deep">
                          {t('当前')}
                        </span>
                      )}
                    </span>
                    {(u.profile.role || u.profile.major) && (
                      <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                        {[u.profile.role, u.profile.major].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="border-t border-line px-3 py-2.5 text-[10.5px] leading-relaxed text-ink-faint">
            {t('各用户的学习目标、知识节点与对话记录相互隔离，分别保存在本浏览器。')}
          </div>
        </nav>

        {/* 右：画像表单 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-line px-5 py-3">
            <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink-strong">
              {editing ? displayName(editing.profile) : t('用户画像')}
            </h2>
            {editing && !isActive && (
              <button
                type="button"
                onClick={() => {
                  onSelect(editing.id)
                  onToast(t('已切换到「{0}」', displayName(editing.profile)))
                }}
                className="rounded-lg border border-seal/30 bg-seal/5 px-2.5 py-1.5 text-[11.5px] font-medium text-seal-deep transition hover:border-seal/50 hover:bg-seal/10"
              >
                {t('切换到该用户')}
              </button>
            )}
            {editing && (
              <button
                type="button"
                title={users.length <= 1 ? t('至少保留一个用户') : t('删除该用户')}
                disabled={users.length <= 1}
                onClick={() => setPendingDelete(editing)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-seal/10 hover:text-seal-deep disabled:pointer-events-none disabled:opacity-30"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              type="button"
              title={t('关闭')}
              onClick={close}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
            >
              <X size={16} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <section className="flex items-start gap-4">
              <div className="relative">
                {editing && <UserAvatar profile={draft} seed={editing.id} size={64} />}
                {busy && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-ink/40">
                    <Loader2 size={18} className="animate-spin text-white" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-2 text-[12.5px] text-ink-soft">{t('头像')}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] text-ink-soft transition hover:border-seal/50 hover:text-seal-deep disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Upload size={13} /> {t('上传图片')}
                  </button>
                  {draft.avatar && (
                    <button
                      type="button"
                      onClick={() => set('avatar', '')}
                      className="rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
                    >
                      {t('移除')}
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  {t('未上传时用昵称首字作为文字头像。图片会压缩后仅存本机。')}
                </p>
              </div>
            </section>

            <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label={t('昵称')}>
                <input
                  value={draft.nickname}
                  onChange={(e) => set('nickname', e.target.value)}
                  placeholder={t('界面上的称呼')}
                  className={FIELD}
                  {...NO_AUTOFILL}
                />
              </Field>
              <Field label={t('年龄')}>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={draft.age ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    set('age', v === '' ? null : Number(v))
                  }}
                  placeholder={t('选填')}
                  className={FIELD}
                  {...NO_AUTOFILL}
                />
              </Field>
              <Field label={t('性别')}>
                <div className="flex flex-wrap gap-1.5">
                  {GENDER_OPTIONS.map((g: Gender) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => set('gender', g)}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] transition ${
                        draft.gender === g
                          ? 'border-seal/50 bg-seal/5 font-medium text-seal-deep'
                          : 'border-line bg-card text-ink-soft hover:text-ink'
                      }`}
                    >
                      {t(GENDER_LABEL[g])}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            <div className="mt-5 rounded-lg border border-seal/25 bg-seal/[0.04] px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
              {t('下面这些会写进超级导师的系统提示词，用来调整讲解的语言、深度与举例场景。填写越具体，讲解越贴合。上面的昵称与年龄同样会一并带上。')}
            </div>

            <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label={t('语言')} hint={t('AI 用它来讲解')}>
                <input
                  list="moji-user-languages"
                  value={draft.language}
                  onChange={(e) => set('language', e.target.value)}
                  placeholder={t('如：中文')}
                  className={FIELD}
                  {...NO_AUTOFILL}
                />
                <datalist id="moji-user-languages">
                  {LANGUAGE_OPTIONS.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </Field>
              <Field label={t('教育程度')}>
                <input
                  list="moji-user-educations"
                  value={draft.education}
                  onChange={(e) => set('education', e.target.value)}
                  placeholder={t('如：本科')}
                  className={FIELD}
                  {...NO_AUTOFILL}
                />
                <datalist id="moji-user-educations">
                  {EDUCATION_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {t(o)}
                    </option>
                  ))}
                </datalist>
              </Field>
              <Field label={t('专业背景')}>
                <input
                  value={draft.major}
                  onChange={(e) => set('major', e.target.value)}
                  placeholder={t('如：计算机科学')}
                  className={FIELD}
                  {...NO_AUTOFILL}
                />
              </Field>
              <Field label={t('当前身份')}>
                <input
                  list="moji-user-roles"
                  value={draft.role}
                  onChange={(e) => set('role', e.target.value)}
                  placeholder={t('如：后端工程师')}
                  className={FIELD}
                  {...NO_AUTOFILL}
                />
                <datalist id="moji-user-roles">
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {t(o)}
                    </option>
                  ))}
                </datalist>
              </Field>
            </div>

            <div className="mt-3.5 grid grid-cols-1 gap-3.5">
              <Field label={t('工作经验')} hint={t('选填，帮助 AI 挑更贴近你场景的例子')}>
                <textarea
                  value={draft.experience}
                  onChange={(e) => set('experience', e.target.value)}
                  rows={2}
                  placeholder={t('如：3 年 Java 后端，最近在学机器学习')}
                  className={`${FIELD} resize-y leading-relaxed`}
                  {...NO_AUTOFILL}
                />
              </Field>
              <Field label={t('已掌握技能')} hint={t('选填，逗号分隔')}>
                <textarea
                  value={draft.skills}
                  onChange={(e) => set('skills', e.target.value)}
                  rows={2}
                  placeholder={t('如：Java、Spring、SQL、Linux')}
                  className={`${FIELD} resize-y leading-relaxed`}
                  {...NO_AUTOFILL}
                />
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">
              {dirty ? t('有未保存的改动') : t('已是最新')}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              title={t('退出登录后回到登录页')}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-seal/40 hover:text-seal-deep"
            >
              <LogOut size={13} /> {t('退出登录')}
            </button>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg px-3.5 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
              >
                {t('关闭')}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!editing || !dirty}
                className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-[12px] font-medium text-paper shadow-sm transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-40"
              >
                <Check size={13} /> {t('保存')}
              </button>
            </div>
          </div>
        </div>

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
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={t('删除这个用户？')}
          message={t('「{0}」的学习目标、对话历史与个人画像都会被移除，且无法恢复。', displayName(pendingDelete.profile))}
          confirmLabel={t('删除用户')}
          onConfirm={() => {
            onDelete(pendingDelete.id)
            setPendingDelete(null)
            onToast(t('已删除该用户及其数据'))
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </ModalScrim>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5">
        <UserRound size={11} className="translate-y-px text-ink-faint" />
        <span className="text-[12px] text-ink-soft">{label}</span>
        {hint && <span className="text-[10.5px] text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

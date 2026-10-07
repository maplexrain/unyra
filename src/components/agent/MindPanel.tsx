import { useState } from 'react'
import { Brain, Pencil, Plus, Trash2 } from 'lucide-react'
import type { MindEntry } from '../../learn/types'
import { MIND_MAX_CHARS } from '../../learn/mind'
import { pane } from '../Pane'
import { t } from '../../i18n'

/**
 * 记忆管理页（文档区页签 kind 'mind'，入口在 agent 栏输入框的「+」菜单）：
 * 超级导师写下的长期记忆（learn/mind 的 mind.*）在这里查看与编辑。
 *
 * 记忆按学习目标归档（store.minds[goalId]），这页跟着工作区的活动目标走——
 * 页签全局只有一枚，切到哪个目标它就显示哪个目标的记忆。
 *
 * 记忆的数据本身**从不自动进上下文**（那是前缀缓存的宪法，见 learn/mind 文件头）：
 * 导师要用得自己 mind.list()/read() 来取，所以这里写下的内容不会立刻改变他的行为，
 * 而是等他下一次主动翻记忆时生效。
 */

interface Props {
  /** 活动目标的 id；null = 还没有活动目标（整页只给一句说明） */
  goalId: string | null
  goalTitle: string
  entries: MindEntry[]
  /** 写入（writeMind：同 key 覆盖，否则新增） */
  onWrite: (input: { key?: string; text: string }) => void
  /** 按覆盖写（记忆管理页的编辑：条目身份不动，只换正文） */
  onUpdate: (id: string, text: string) => void
  onDelete: (idOrKey: string) => void
  onClear: () => void
  onToast: (msg: string) => void
}

/** 列表里的时间：到分钟为止，够认出先后即可 */
const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function MindPanel({ goalId, goalTitle, entries, onWrite, onUpdate, onDelete, onClear, onToast }: Props) {
  /** 两步清空：第一下只是 arm，5 秒内再点一下才真清（同 UsagePanel 的做法） */
  const [confirmClear, setConfirmClear] = useState(false)
  /** 正在编辑的条目 id 与草稿；null = 没有在编辑 */
  const [editing, setEditing] = useState<string | null>(null)
  const [draftText, setDraftText] = useState('')
  /** 新增表单：主题（可选）+ 正文 */
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newText, setNewText] = useState('')

  if (!goalId) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-paper">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
          <Brain size={15} className="text-seal" />
          <h2 className="text-[15px] font-semibold text-ink-strong">{t('记忆管理')}</h2>
        </header>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-relaxed text-ink-faint">
          {t('还没有活动目标：打开任意学习目标后，这里显示导师为它写下的记忆。')}
        </div>
      </div>
    )
  }

  const submitNew = () => {
    const text = newText.trim()
    if (!text) return
    onWrite({ key: newKey.trim() || undefined, text })
    setNewText('')
    setNewKey('')
    setAdding(false)
    onToast(t('记忆已写入'))
  }

  const saveEdit = () => {
    if (!editing) return
    const text = draftText.trim()
    if (!text) return
    onUpdate(editing, text)
    setEditing(null)
    onToast(t('记忆已更新'))
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-paper">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
        <Brain size={15} className="text-seal" />
        <h2 className="text-[15px] font-semibold text-ink-strong">{t('记忆管理')}</h2>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-faint">
          {t('当前目标')}: {goalTitle}
        </span>
        {entries.length > 0 &&
          (confirmClear ? (
            <button
              type="button"
              onClick={() => {
                setConfirmClear(false)
                onClear()
                onToast(t('记忆已清空'))
              }}
              onBlur={() => setConfirmClear(false)}
              className="rounded-lg border border-warn/40 px-2.5 py-1 text-[11.5px] text-warn-deep transition hover:bg-warn/10"
            >
              {t('再点一次确认清空')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirmClear(true)
                window.setTimeout(() => setConfirmClear(false), 5000)
              }}
              className="rounded-lg px-2.5 py-1 text-[11.5px] text-ink-faint transition hover:bg-line/60 hover:text-warn-deep"
            >
              {t('清空')}
            </button>
          ))}
      </header>

      <div className={pane(4, true)}>
        <p className="text-[11.5px] leading-relaxed text-ink-faint">
          {t('导师用 mind.write 记下的跨对话判断与偏好。它们不自动进上下文——他要自己想起来翻，才用得上；同主题再写一次就只剩最新那条。')}
        </p>

        {/* 新增一条：主题给 key（同 key 覆盖），不填就是一条无主题的记忆 */}
        {adding ? (
          <section className="rounded-lg border border-line bg-card px-3.5 py-3">
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={t('主题（可选，同主题只留最新一条）')}
              maxLength={80}
              className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/60"
            />
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder={t('内容：希望导师跨对话记住的判断、约定或偏好')}
              maxLength={MIND_MAX_CHARS}
              rows={4}
              className="mt-2 w-full resize-y rounded-lg border border-line bg-paper px-3 py-2 text-[12px] leading-relaxed text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/60"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setAdding(false)
                  setNewText('')
                  setNewKey('')
                }}
                className="rounded-lg px-3 py-1.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
              >
                {t('取消')}
              </button>
              <button
                type="button"
                onClick={submitNew}
                disabled={!newText.trim()}
                className="rounded-lg border border-seal/50 bg-seal/10 px-3 py-1.5 text-[11.5px] text-seal-deep transition hover:bg-seal/20 disabled:pointer-events-none disabled:opacity-40"
              >
                {t('写入')}
              </button>
            </div>
          </section>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 self-start rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
          >
            <Plus size={14} />
            {t('写一条记忆')}
          </button>
        )}

        {entries.length ? (
          <ul className="flex flex-col gap-2.5">
            {entries.map((m) => (
              <li key={m.id} className="rounded-lg border border-line bg-card px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  {m.key ? (
                    <code className="rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[10.5px] text-seal-deep">{m.key}</code>
                  ) : (
                    <span className="text-[11px] text-ink-faint">{t('无主题')}</span>
                  )}
                  <span className="ml-auto shrink-0 text-[10.5px] text-ink-faint">{fmtTime(m.updatedAt)}</span>
                  {editing !== m.id && (
                    <>
                      <button
                        type="button"
                        title={t('编辑')}
                        onClick={() => {
                          setEditing(m.id)
                          setDraftText(m.text)
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        title={t('删除')}
                        onClick={() => {
                          onDelete(m.id)
                          onToast(t('记忆已删除'))
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-warn-deep"
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
                {editing === m.id ? (
                  <div className="mt-2">
                    <textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      maxLength={MIND_MAX_CHARS}
                      rows={5}
                      className="w-full resize-y rounded-lg border border-line bg-paper px-3 py-2 text-[12px] leading-relaxed text-ink-strong outline-none transition focus:border-seal/60"
                    />
                    <div className="mt-1.5 flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="rounded-lg px-3 py-1.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
                      >
                        {t('取消')}
                      </button>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={!draftText.trim()}
                        className="rounded-lg border border-seal/50 bg-seal/10 px-3 py-1.5 text-[11.5px] text-seal-deep transition hover:bg-seal/20 disabled:pointer-events-none disabled:opacity-40"
                      >
                        {t('保存')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-soft">{m.text}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] text-ink-faint">
            {t('（这个目标还没有记忆。导师在对话里认下你的偏好或定下约定时会自己写；也可以在上面手动加一条。）')}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * 外部智能体：管理 `users/{uid}/agents/{id}/` 下的独立配置。
 *
 * 目录名即 agent id；agent.json 存名称 / 简介 / 头像，prompts/ 存专属提示词，
 * assets/ 存头像等静态资源。这里只负责建与改配置，运行时名册接入不在此处。
 */
import { useState, useSyncExternalStore } from 'react'
import { Bot, FolderOpen, Plus } from 'lucide-react'
import {
  createExternalAgent,
  getExternalAgents,
  subscribeExternalAgents,
  updateExternalAgent,
  type ExternalAgentConfig,
} from '../../agent/externalAgentStore'
import { t } from '../../i18n'

function AgentCard({ agent }: { agent: ExternalAgentConfig }) {
  const [name, setName] = useState(agent.name)
  const [bio, setBio] = useState(agent.bio ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (saving) return
    if (name.trim() === agent.name && bio.trim() === (agent.bio ?? '')) return
    setSaving(true)
    await updateExternalAgent(agent.id, { name, bio })
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line/70 bg-paper-deep/30 p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line/70 bg-card text-ink-soft">
          <Bot size={16} />
        </span>
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void save()}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-[13px] font-semibold text-ink-strong outline-none hover:border-line/70 focus:border-seal/60 focus:bg-card"
        />
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-line/55 px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
          <FolderOpen size={11} />
          {agent.id}
        </span>
      </div>
      <textarea
        value={bio}
        maxLength={200}
        rows={2}
        placeholder={t('简介')}
        onChange={(e) => setBio(e.target.value)}
        onBlur={() => void save()}
        className="min-h-[46px] resize-none rounded-md border border-line/70 bg-card px-2 py-1.5 text-[12px] text-ink-strong outline-none placeholder:text-ink-faint focus:border-seal/60"
      />
      <p className="font-mono text-[10px] text-ink-faint">
        agents/{agent.id}/agent.json · prompts/ · assets/
      </p>
    </div>
  )
}

export function ExternalAgentsPanel({ onToast }: { onToast?: (msg: string) => void }) {
  const agents = useSyncExternalStore(subscribeExternalAgents, getExternalAgents, getExternalAgents)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (busy) return
    setBusy(true)
    const created = await createExternalAgent(draft.trim() || t('新智能体'))
    setBusy(false)
    if (!created) {
      onToast?.(t('创建外部智能体失败，请重试'))
      return
    }
    setDraft('')
    setCreating(false)
    onToast?.(t('已创建外部智能体「{0}」', created.name))
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink-strong">{t('外部智能体')}</h3>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-line/70 px-2 py-1 text-[11.5px] text-ink-soft hover:bg-line/35"
        >
          <Plus size={13} />
          {t('新建')}
        </button>
      </div>

      {creating && (
        <div className="flex items-center gap-1.5 rounded-lg border border-line/70 bg-paper-deep/30 p-2.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
              if (e.key === 'Escape') setCreating(false)
            }}
            placeholder={t('名称')}
            className="min-w-0 flex-1 rounded-md border border-line/70 bg-paper px-2 py-1.5 text-[12px] text-ink-strong outline-none focus:border-line-strong"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="rounded-md bg-ink-strong px-2.5 py-1 text-[11px] font-medium text-paper disabled:opacity-40"
          >
            {busy ? t('创建中…') : t('创建')}
          </button>
        </div>
      )}

      {agents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line/70 px-3 py-6 text-center text-[12px] text-ink-faint">
          {t('还没有外部智能体')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {agents.map((agent) => (
            <AgentCard key={`${agent.id}:${agent.updatedAt ?? 0}`} agent={agent} />
          ))}
        </div>
      )}
    </div>
  )
}

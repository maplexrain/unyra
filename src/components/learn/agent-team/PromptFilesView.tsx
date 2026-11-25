/**
 * 提示词文件编排：agent 设置页只列「文件项」，不再展开系统提示词正文。
 *
 * - role / work 两层切换；每层各有自己的顺序与启停；
 * - 内置文件只读：可调顺序、可停用，不能改内容/删除；
 * - 外置文件可新建、改名、写内容、删除；
 * - 顺序即注入顺序，保存后下一轮请求立即按新顺序拼系统提示词。
 */
import { useState } from 'react'
import { ArrowDown, ArrowUp, Lock, Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import type { AgentProfileId } from '../../../agent/agentProfile'
import {
  type ExternalPromptFile,
  type PromptFileLayer,
  type PromptFileSettings,
} from '../../../agent/promptFiles'
import { listPromptFiles } from '../../../learn/ai/promptFiles'
import { t } from '../../../i18n'

function withLayerOrder(
  settings: PromptFileSettings,
  agentId: AgentProfileId,
  layer: PromptFileLayer,
  ids: string[],
): PromptFileSettings {
  return {
    ...settings,
    order: {
      ...settings.order,
      [agentId]: { ...settings.order?.[agentId], [layer]: ids },
    },
  }
}

function withDisabled(
  settings: PromptFileSettings,
  agentId: AgentProfileId,
  layer: PromptFileLayer,
  ids: string[],
): PromptFileSettings {
  return {
    ...settings,
    disabled: {
      ...settings.disabled,
      [agentId]: { ...settings.disabled?.[agentId], [layer]: ids },
    },
  }
}

export function PromptFilesView({
  agentId,
  settings,
  onChange,
}: {
  agentId: AgentProfileId
  settings: PromptFileSettings
  onChange: (next: PromptFileSettings) => void
}) {
  const [layer, setLayer] = useState<PromptFileLayer>('role')
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const files = listPromptFiles(agentId, layer, settings)
  const disabled = settings.disabled?.[agentId]?.[layer] ?? []

  const move = (id: string, delta: -1 | 1) => {
    const ids = files.map((file) => file.id)
    const idx = ids.indexOf(id)
    const next = idx + delta
    if (idx < 0 || next < 0 || next >= ids.length) return
    ids.splice(idx, 1)
    ids.splice(next, 0, id)
    onChange(withLayerOrder(settings, agentId, layer, ids))
  }

  const toggle = (id: string) => {
    const next = disabled.includes(id) ? disabled.filter((x) => x !== id) : [...disabled, id]
    onChange(withDisabled(settings, agentId, layer, next))
  }

  const removeExternal = (id: string) => {
    const next = {
      ...settings,
      external: settings.external.filter((file) => file.id !== id),
    }
    onChange(next)
  }

  const patchExternal = (id: string, patch: Partial<ExternalPromptFile>) => {
    onChange({
      ...settings,
      external: settings.external.map((file) => (file.id === id ? { ...file, ...patch } : file)),
    })
  }

  const addExternal = () => {
    const name = draftName.trim()
    if (!name) return
    const file: ExternalPromptFile = {
      id: `ext-${crypto.randomUUID()}`,
      name: name.slice(0, 40),
      layer,
      content: draftContent,
    }
    onChange({ ...settings, external: [...settings.external, file] })
    setDraftName('')
    setDraftContent('')
    setAdding(false)
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1">
        {(['role', 'work'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setLayer(item)}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
              layer === item
                ? 'bg-ink-strong text-paper'
                : 'bg-line/40 text-ink-soft hover:bg-line/60'
            }`}
          >
            {item === 'role' ? t('role 层') : t('work 层')}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-line/70 px-2 py-1 text-[12px] text-ink-soft hover:bg-line/35"
        >
          <Plus size={13} />
          {t('新建外置文件')}
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 rounded-lg border border-line/70 bg-paper-deep/30 p-2.5">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={t('文件名称')}
            className="rounded-md border border-line/70 bg-paper px-2 py-1.5 text-[12px] text-ink-strong outline-none focus:border-line-strong"
          />
          <textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            placeholder={t('提示词内容')}
            rows={4}
            className="resize-y rounded-md border border-line/70 bg-paper px-2 py-1.5 text-[12px] leading-relaxed text-ink-strong outline-none focus:border-line-strong"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-md px-2 py-1 text-[11px] text-ink-faint hover:bg-line/35"
            >
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={addExternal}
              disabled={!draftName.trim()}
              className="rounded-md bg-ink-strong px-2.5 py-1 text-[11px] font-medium text-paper disabled:opacity-40"
            >
              {t('添加')}
            </button>
          </div>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-line/50 rounded-lg border border-line/70 bg-paper-deep/30">
        {files.map((file, idx) => (
          <li key={file.id} className="flex flex-col gap-1 px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-ink-faint">
                {idx + 1}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-[12px] font-medium ${
                  file.enabled ? 'text-ink-strong' : 'text-ink-faint line-through'
                }`}
              >
                {t(file.name)}
              </span>
              {file.builtin && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-line/55 px-1.5 py-px text-[10px] text-ink-faint">
                  <Lock size={9} />
                  {t('内置')}
                </span>
              )}
              <button
                type="button"
                onClick={() => move(file.id, -1)}
                disabled={idx === 0}
                className="rounded p-0.5 text-ink-faint hover:bg-line/40 disabled:opacity-25"
                title={t('上移')}
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                onClick={() => move(file.id, 1)}
                disabled={idx === files.length - 1}
                className="rounded p-0.5 text-ink-faint hover:bg-line/40 disabled:opacity-25"
                title={t('下移')}
              >
                <ArrowDown size={13} />
              </button>
              <button
                type="button"
                onClick={() => toggle(file.id)}
                className={`rounded p-0.5 hover:bg-line/40 ${file.enabled ? 'text-ink-soft' : 'text-ink-faint'}`}
                title={file.enabled ? t('停用') : t('启用')}
              >
                {file.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              {!file.builtin && (
                <button
                  type="button"
                  onClick={() => removeExternal(file.id)}
                  className="rounded p-0.5 text-ink-faint hover:bg-rose-500/10 hover:text-rose-500"
                  title={t('删除')}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            {!file.builtin && (
              <div className="pl-6">
                {editingId === file.id ? (
                  <div className="flex flex-col gap-1.5">
                    <textarea
                      value={settings.external.find((f) => f.id === file.id)?.content ?? ''}
                      onChange={(e) => patchExternal(file.id, { content: e.target.value })}
                      rows={4}
                      className="resize-y rounded-md border border-line/70 bg-paper px-2 py-1.5 text-[12px] leading-relaxed text-ink-strong outline-none focus:border-line-strong"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="self-end rounded-md bg-line/45 px-2 py-0.5 text-[11px] text-ink-soft"
                    >
                      {t('收起')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingId(file.id)}
                    className="rounded px-1 py-0.5 text-[11px] text-ink-faint hover:bg-line/35 hover:text-ink-soft"
                  >
                    {t('编辑内容')}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 提示词文件编排：agent 设置页只列「文件项」，正文一律在文档页签里看/改。
 *
 * - role / work 两层切换；每层各有自己的顺序与启停；
 * - 内置文件只读：可调顺序、可停用，点开是一枚**只读**的内置提示词页签；
 * - 外置文件是 `users/{uid}/prompts/*.md` 的共用文件：新建即落一个 md、并当场打开它；
 *   点开走普通本地文件页签，可直接编辑保存（保存后下一轮立即生效）；
 * - 顺序即注入顺序，保存后下一轮请求立即按新顺序拼系统提示词。
 */
import { useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, FileText, Lock, Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import type { AgentProfileId } from '../../../agent/agentProfile'
import { type PromptFileLayer, type PromptFileSettings } from '../../../agent/promptFiles'
import {
  createPromptFile,
  deletePromptFile,
  getExternalPromptFiles,
  subscribePromptFiles,
} from '../../../agent/promptFileStore'
import { listPromptFiles, type PromptFileItem } from '../../../learn/ai/promptFiles'
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
  onOpenFile,
}: {
  agentId: AgentProfileId
  settings: PromptFileSettings
  onChange: (next: PromptFileSettings) => void
  onOpenFile?: (file: PromptFileItem) => void
}) {
  const [layer, setLayer] = useState<PromptFileLayer>('role')
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // prompts/ 目录由 store 持有；文件被保存/删除/外部改名后列表随之刷新
  useSyncExternalStore(subscribePromptFiles, getExternalPromptFiles, getExternalPromptFiles)

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

  const removeExternal = async (fileName: string) => {
    await deletePromptFile(fileName)
  }

  const addExternal = async () => {
    const name = draftName.trim()
    if (!name || busy) return
    setBusy(true)
    setError('')
    const created = await createPromptFile(name)
    setBusy(false)
    if (!created) {
      setError(t('新建提示词文件失败，请重试'))
      return
    }
    setDraftName('')
    setAdding(false)
    onOpenFile?.({
      id: created.id,
      name: created.name,
      layer,
      builtin: false,
      fileName: created.fileName,
      order: 1,
      enabled: true,
      content: created.content,
    })
  }

  const createWithKeyboard = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void addExternal()
    if (e.key === 'Escape') setAdding(false)
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
          {t('新建提示词文件')}
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-line/70 bg-paper-deep/30 p-2.5">
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={createWithKeyboard}
            placeholder={t('文件名（保存为 prompts/ 下的 md）')}
            className="rounded-md border border-line/70 bg-paper px-2 py-1.5 text-[12px] text-ink-strong outline-none focus:border-line-strong"
          />
          {error && <p className="text-[11px] text-rose-500">{error}</p>}
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
              onClick={() => void addExternal()}
              disabled={!draftName.trim() || busy}
              className="rounded-md bg-ink-strong px-2.5 py-1 text-[11px] font-medium text-paper disabled:opacity-40"
            >
              {busy ? t('创建中…') : t('创建并打开')}
            </button>
          </div>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-line/50 rounded-lg border border-line/70 bg-paper-deep/30">
        {files.map((file, idx) => (
          <li
            key={file.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpenFile?.(file)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpenFile?.(file)
              }
            }}
            className="group flex cursor-pointer items-center gap-1.5 px-2.5 py-2 transition hover:bg-line/25"
          >
            <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-ink-faint">
              {idx + 1}
            </span>
            {file.builtin ? (
              <Lock size={12} className="shrink-0 text-ink-faint" />
            ) : (
              <FileText size={12} className="shrink-0 text-ink-faint" />
            )}
            <span
              className={`min-w-0 flex-1 truncate text-[12px] font-medium ${
                file.enabled ? 'text-ink-strong' : 'text-ink-faint line-through'
              }`}
            >
              {file.builtin ? t(file.name) : file.name}
            </span>
            {file.builtin && (
              <span className="inline-flex shrink-0 items-center rounded bg-line/55 px-1.5 py-px text-[10px] text-ink-faint">
                {t('内置')}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                move(file.id, -1)
              }}
              disabled={idx === 0}
              className="rounded p-0.5 text-ink-faint hover:bg-line/40 disabled:opacity-25"
              title={t('上移')}
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                move(file.id, 1)
              }}
              disabled={idx === files.length - 1}
              className="rounded p-0.5 text-ink-faint hover:bg-line/40 disabled:opacity-25"
              title={t('下移')}
            >
              <ArrowDown size={13} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggle(file.id)
              }}
              className={`rounded p-0.5 hover:bg-line/40 ${file.enabled ? 'text-ink-soft' : 'text-ink-faint'}`}
              title={file.enabled ? t('停用') : t('启用')}
            >
              {file.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            {!file.builtin && file.fileName && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void removeExternal(file.fileName as string)
                }}
                className="rounded p-0.5 text-ink-faint hover:bg-rose-500/10 hover:text-rose-500"
                title={t('删除文件')}
              >
                <Trash2 size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

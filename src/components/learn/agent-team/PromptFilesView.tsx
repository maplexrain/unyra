/**
 * 提示词文件编排：agent 设置页只列「已加入当前 agent 的文件项」，正文在文档页签里看/改。
 *
 * - role / work 两层切换；每层各有自己的顺序与启停；
 * - 内置文件只读，始终在本层里；可调顺序、可停用，点开是只读提示词页签；
 * - 外置文件是候选库：共用文件在 `users/{uid}/prompts/`，专属文件在
 *   `users/{uid}/agents/{agent-id}/prompts/`。只有点「添加」显式加入当前层后才注入；
 * - 新建文件分「共用 / 专属」两种落盘位置；两者建完都不自动加入任何 agent，需在候选库里显式添加；
 * - 点开外置文件走普通本地页签，保存后下一轮立即生效。
 */
import { useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, FilePlus2, FileText, FolderOpen, Lock, Plus, Trash2, X, Eye, EyeOff } from 'lucide-react'
import type { AgentProfileId } from '../../../agent/agentProfile'
import { type PromptFileLayer, type PromptFileSettings } from '../../../agent/promptFiles'
import {
  createPromptFile,
  deletePromptFile,
  getExternalPromptFiles,
  subscribePromptFiles,
  type PromptFileScope,
} from '../../../agent/promptFileStore'
import { buildPromptFileSystem, listPromptFiles, type PromptFileItem } from '../../../learn/ai/promptFiles'
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

function scopeBadge(scope: PromptFileScope | undefined): string {
  return scope === 'agent' ? t('专属') : t('共用')
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
  const [creating, setCreating] = useState(false)
  const [picking, setPicking] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftScope, setDraftScope] = useState<PromptFileScope>('common')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // prompts/ 与 agents/<id>/prompts/ 由 store 持有；文件被保存/删除/外部改名后列表随之刷新
  const external = useSyncExternalStore(subscribePromptFiles, getExternalPromptFiles, getExternalPromptFiles)

  const files = listPromptFiles(agentId, layer, settings)
  const disabled = settings.disabled?.[agentId]?.[layer] ?? []
  const selectedIds = new Set(files.map((file) => file.id))
  const preview = buildPromptFileSystem(agentId, layer, settings)
  const available = external.filter(
    (file) =>
      (file.scope === 'common' || file.agentId === agentId) &&
      !selectedIds.has(file.id),
  )

  const commitOrder = (next: PromptFileItem[]) => {
    onChange(withLayerOrder(settings, agentId, layer, next.map((file) => file.id)))
  }

  const move = (id: string, delta: -1 | 1) => {
    const idx = files.findIndex((file) => file.id === id)
    const next = idx + delta
    if (idx < 0 || next < 0 || next >= files.length) return
    const ordered = [...files]
    const [row] = ordered.splice(idx, 1)
    if (!row) return
    ordered.splice(next, 0, row)
    commitOrder(ordered)
  }

  const toggle = (id: string) => {
    const next = disabled.includes(id) ? disabled.filter((x) => x !== id) : [...disabled, id]
    onChange(withDisabled(settings, agentId, layer, next))
  }

  const addFile = (file: PromptFileItem) => {
    commitOrder([...files, file])
    setPicking(false)
  }

  const removeSelected = (file: PromptFileItem) => {
    commitOrder(files.filter((row) => row.id !== file.id))
  }

  const removeFile = async (file: PromptFileItem) => {
    if (!file.relPath) return
    await deletePromptFile({ relPath: file.relPath })
  }

  const createFile = async () => {
    const name = draftName.trim()
    if (!name || busy) return
    setBusy(true)
    setError('')
    const scope = draftScope
    const created = await createPromptFile(name, { scope, agentId })
    setBusy(false)
    if (!created) {
      setError(t('新建提示词文件失败，请重试'))
      return
    }
    setDraftName('')
    setCreating(false)
    const item: PromptFileItem = {
      id: created.id,
      name: created.name,
      layer,
      builtin: false,
      fileName: created.fileName,
      relPath: created.relPath,
      scope: created.scope,
      ...(created.agentId ? { agentId: created.agentId } : {}),
      order: files.length + 1,
      enabled: true,
      content: created.content,
    }
    // 只落盘并打开文件；要注入当前 agent，仍需在「添加文件」里显式选择
    onOpenFile?.(item)
  }

  const createWithKeyboard = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void createFile()
    if (e.key === 'Escape') setCreating(false)
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
          onClick={() => {
            setPicking((v) => !v)
            setCreating(false)
            setError('')
          }}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-line/70 px-2 py-1 text-[12px] text-ink-soft hover:bg-line/35"
        >
          <FolderOpen size={13} />
          {t('添加文件')}
        </button>
        <button
          type="button"
          onClick={() => {
            setCreating((v) => !v)
            setPicking(false)
            setError('')
          }}
          className="inline-flex items-center gap-1 rounded-md border border-line/70 px-2 py-1 text-[12px] text-ink-soft hover:bg-line/35"
        >
          <FilePlus2 size={13} />
          {t('新建文件')}
        </button>
      </div>

      {picking && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-line/70 bg-paper-deep/30 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-ink-soft">{t('可用的提示词文件')}</span>
            <button type="button" onClick={() => setPicking(false)} className="rounded p-0.5 text-ink-faint hover:bg-line/35">
              <X size={13} />
            </button>
          </div>
          {available.length === 0 ? (
            <p className="px-1 py-1.5 text-[11.5px] text-ink-faint">{t('没有可添加的文件')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {available.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() =>
                      addFile({
                        id: file.id,
                        name: file.name,
                        layer,
                        builtin: false,
                        fileName: file.fileName,
                        relPath: file.relPath,
                        scope: file.scope,
                        ...(file.agentId ? { agentId: file.agentId } : {}),
                        order: files.length + 1,
                        enabled: true,
                        content: file.content,
                      })
                    }
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition hover:bg-line/30"
                  >
                    <FileText size={12} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-strong">{file.name}</span>
                    <span className="shrink-0 rounded bg-line/55 px-1.5 py-px text-[10px] text-ink-faint">
                      {scopeBadge(file.scope)}
                    </span>
                    <Plus size={13} className="shrink-0 text-ink-soft" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {creating && (
        <div className="flex flex-col gap-2 rounded-lg border border-line/70 bg-paper-deep/30 p-2.5">
          <div className="flex items-center gap-1">
            {(['common', 'agent'] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                aria-pressed={draftScope === scope}
                onClick={() => setDraftScope(scope)}
                className={`rounded-md px-2 py-0.5 text-[11px] transition ${
                  draftScope === scope
                    ? 'bg-card font-semibold text-ink-strong shadow-2xs ring-1 ring-line/70'
                    : 'text-ink-soft hover:bg-line/30'
                }`}
              >
                {scope === 'common' ? t('共用') : t('专属')}
              </button>
            ))}
          </div>
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={createWithKeyboard}
            placeholder={t('文件名')}
            className="rounded-md border border-line/70 bg-paper px-2 py-1.5 text-[12px] text-ink-strong outline-none focus:border-line-strong"
          />
          {error && <p className="text-[11px] text-rose-500">{error}</p>}
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md px-2 py-1 text-[11px] text-ink-faint hover:bg-line/35"
            >
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={() => void createFile()}
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
            <span className="inline-flex shrink-0 items-center rounded bg-line/55 px-1.5 py-px text-[10px] text-ink-faint">
              {file.builtin ? t('内置') : scopeBadge(file.scope)}
            </span>
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
            {!file.builtin && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeSelected(file)
                }}
                className="rounded p-0.5 text-ink-faint hover:bg-line/40"
                title={t('从当前提示词移除')}
              >
                <X size={13} />
              </button>
            )}
            {!file.builtin && file.relPath && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void removeFile(file)
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

      {/* 列表下方是运行时真正拼出来的整份提示词：顺序、启停与空行都和下一轮注入一致。 */}
      <div
        data-prompt-preview
        aria-label={t('拼接后的提示词预览')}
        className="mt-3 rounded-lg border border-line/70 bg-paper-deep/30 px-2.5 py-2"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText size={12} className="shrink-0 text-seal/75" />
          <span className="text-[11.5px] font-medium text-ink-strong">{t('拼接后的提示词预览')}</span>
          <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-ink-faint">
            {t('{0} 字符', preview.trim().length)}
          </span>
        </div>
        <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-paper px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-soft">
          {preview.trim() ? preview : t('这一层还没有启用的提示词文件。')}
        </pre>
      </div>
    </div>
  )
}

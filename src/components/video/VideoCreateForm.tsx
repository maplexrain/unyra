/**
 * 视频页签·创建态表单（VideoStudyTab 拆分模块）：
 * 全局一份的新建视频页（键 v:new）——只有一个输入框 + 创建按钮。输入不一定是
 * URL——交给已装载的插件逐个 `match()` 认领，认领后展示该插件的 `createFields`
 * 表单，填完创建。插件与输入在这一刻确定，之后不再让用户重填。
 *
 * 原样搬自 VideoStudyTab.tsx 的创建态区块（INPUT_KEY 输入记忆、匹配、表单值、
 * create 回调与整套 JSX、CreateField 字段渲染，注释一并带走）；
 * `VideoCreateDraft` 类型由本文件拥有，门面 VideoStudyTab 转发导出（调用方引用路径不变）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clapperboard, Plus, Puzzle } from 'lucide-react'
import { t } from '../../i18n'
import { matchVideoPlugin, videoSourcePlugins } from '../../lib/videoPlugins'
import type { PluginSettingField } from '../../lib/plugins'
import type { VideoResource } from '../../learn/types'

/** 创建态的输入记忆：下次打新建视频，上次粘的链接还在 */
const INPUT_KEY = 'moji.video.input'

const readLastInput = (): string => {
  try {
    return localStorage.getItem(INPUT_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 创建时的工作区回调签名：落库 + 开关页签都在工作区做（页签自己不认识 store） */
export interface VideoCreateDraft {
  pluginId: string
  pluginName: string
  input: string
  fields: Record<string, string | number | boolean>
}

interface Props {
  /** 绑定的视频资源；创建态恒为空（仅输入记忆初始化表达式按原样保留） */
  video?: VideoResource | null
  /** 初始输入（来自视频节点） */
  initialInput?: string
  /** 创建（工作区负责落库、开绑定页签、关掉创建页签） */
  onCreate?: (draft: VideoCreateDraft) => void
}

export default function VideoCreateForm({ video = null, onCreate, initialInput = '' }: Props) {
  /** 创建态输入（绑定态不用它——页里没有输入组件；本组件只在创建态挂载） */
  const [input, setInput] = useState(() => video?.input ?? (initialInput || readLastInput()))

  // 原版条件里的 !bound 在本组件恒成立（只在创建态挂载），行为不变
  useEffect(() => {
    if (initialInput && !input) {
      setInput(initialInput)
    }
  }, [initialInput, input])

  /**
   * 创建态的匹配结果：纯函数，输入一变就重算。
   */
  const matched = useMemo(() => {
    const text = input.trim()
    if (!text) return null
    return matchVideoPlugin(text)
  }, [input])

  const createFields = useMemo<PluginSettingField[]>(() => matched?.plugin.createFields ?? [], [matched])

  const [createOverrides, setCreateOverrides] = useState<{
    pluginId: string
    values: Record<string, string | number | boolean>
  } | null>(null)

  const createValues = useMemo(() => {
    const seed: Record<string, string | number | boolean> = {}
    for (const f of createFields) {
      if (f.default !== undefined) seed[f.key] = f.default
      else if (f.type === 'boolean') seed[f.key] = false
      else seed[f.key] = ''
    }
    const pluginId = matched?.plugin.id ?? ''
    const overrides = createOverrides?.pluginId === pluginId ? createOverrides.values : {}
    return { ...seed, ...overrides }
  }, [createFields, createOverrides, matched?.plugin.id])

  const setCreateValue = useCallback(
    (key: string, value: string | number | boolean) => {
      const pluginId = matched?.plugin.id ?? ''
      setCreateOverrides((prev) => ({
        pluginId,
        values: { ...(prev?.pluginId === pluginId ? prev.values : {}), [key]: value },
      }))
    },
    [matched?.plugin.id],
  )

  const missingRequired = createFields.some((f) => f.required && !String(createValues[f.key] ?? '').trim())

  const create = useCallback(() => {
    if (!matched || missingRequired) return
    const text = input.trim()
    if (!text) return
    try {
      localStorage.setItem(INPUT_KEY, text)
    } catch {
      // 记不住也无碍
    }
    onCreate?.({
      pluginId: matched.plugin.id,
      pluginName: matched.plugin.name ?? matched.plugin.id,
      input: text,
      fields: createValues,
    })
  }, [matched, missingRequired, input, createValues, onCreate])

  const installed = videoSourcePlugins()
  const ready = !!matched && !missingRequired

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-paper">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 px-5 pt-[12vh]">
        <div className="flex items-center gap-2">
          <Clapperboard size={20} className="text-seal" />
          <span className="text-[15px] font-semibold text-ink-strong">{t('新建视频')}</span>
        </div>
        <p className="text-[12px] leading-relaxed text-ink-faint">
          {t('粘贴链接或输入编号，插件会认领它。视频创建后绑定插件与输入，打开页签即自动播放。')}
        </p>

        <div className="mt-1 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && ready) create()
            }}
            placeholder={t('链接或编号（例如 B 站链接 / BV 号）')}
            className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/50 focus:ring-2 focus:ring-seal/10"
          />
          <button
            type="button"
            onClick={create}
            disabled={!ready}
            className="flex h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-pink-600 px-3.5 text-[12px] font-medium text-white transition hover:bg-pink-700 disabled:pointer-events-none disabled:opacity-35 cursor-pointer shadow-sm"
          >
            <Plus size={13} />
            {t('确定为视频资源')}
          </button>
        </div>

        {input.trim() && !matched && (
          <div className="rounded-xl border border-dashed border-line bg-card/50 px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-soft">
            {installed.length
              ? t('没有插件认领这段输入。已安装：{0}', installed.map((p) => p.name ?? p.id).join('、'))
              : t('还没有安装任何视频来源插件：到「设置 → 插件 → 视频 / 音频来源」安装并启用。')}
          </div>
        )}
        {matched && (
          <div className="flex flex-col gap-2.5 rounded-xl border border-seal/30 bg-seal/5 px-3.5 py-3">
            <div className="flex items-center gap-1.5">
              <Puzzle size={13} className="text-seal" />
              <span className="text-[12px] font-medium text-ink-strong">
                {matched.plugin.name ?? matched.plugin.id}
              </span>
              {matched.plugin.version && (
                <span className="text-[10.5px] text-ink-faint">v{matched.plugin.version}</span>
              )}
            </div>
            {createFields.length > 0 && (
              <div className="flex flex-col gap-2">
                {createFields.map((f) => (
                  <CreateField
                    key={f.key}
                    field={f}
                    value={createValues[f.key]}
                    onChange={(v) => setCreateValue(f.key, v)}
                  />
                ))}
              </div>
            )}
            <p className="text-[10.5px] leading-relaxed text-ink-faint">
              {t('上面填的是这个视频专属的数据；插件全局配置（如登录凭据）在「设置 → 插件」里。')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 创建态的表单字段（插件 createFields 的渲染）。
 */
function CreateField({
  field,
  value,
  onChange,
}: {
  field: PluginSettingField
  value: string | number | boolean | undefined
  onChange: (v: string | number | boolean) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      {field.type !== 'static' && (
        <span className="text-[11.5px] font-medium text-ink">
          {field.label}
          {field.required && <span className="ml-0.5 text-seal">*</span>}
        </span>
      )}
      {field.type === 'static' ? (
        <p className="text-[11px] leading-relaxed text-ink-faint">{field.label}</p>
      ) : field.type === 'boolean' ? (
        <button
          type="button"
          onClick={() => onChange(value !== true)}
          className={
            'flex h-7 w-11 items-center rounded-full px-0.5 transition ' +
            (value === true ? 'justify-end bg-seal' : 'justify-start bg-line-strong')
          }
          aria-pressed={value === true}
        >
          <span className="h-6 w-6 rounded-full bg-card shadow" />
        </button>
      ) : field.type === 'select' ? (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1.5 text-[12px] text-ink outline-none focus:border-seal/50"
        >
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          value={String(value ?? '')}
          placeholder={field.placeholder}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1.5 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-seal/50"
        />
      ) : (
        <input
          type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-seal/50"
        />
      )}
      {field.help && <span className="text-[10.5px] leading-relaxed text-ink-faint">{field.help}</span>}
    </label>
  )
}

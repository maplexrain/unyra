/**
 * 单个提供商的配置表单：
 * 分为「基础配置」与「高级配置」，对 Agent 新手友好，减少信息干扰。
 * 具备自动探测并获取模型列表能力，支持官方 Logo 标识，零显式保存（自动保存）。
 */

import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PlugZap,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  ALL_MODALITIES,
  CONTEXT_PRESETS,
  MODALITY_LABEL,
  baseUrlOf,
  isCustomConfig,
  labelOf,
  makeModelEntry,
  modelEntriesOf,
  modelsOf,
  protocolOf,
  type InputModality,
  type ModelEntry,
  type ProviderConfig,
} from '../../ai/settings'
import { PROVIDERS, endpoint, presetOf, type ProviderPreset } from '../../ai/providers'
import { COMPAT_META, COMPAT_PROTOCOLS, compatLabel, type ProviderProtocol } from '../../ai/types'
import { AiRequestError, chatCompleteWith, listModelsWith } from '../../ai/client'
import { NO_AUTOFILL } from '../../lib/autofill'
import { t } from '../../i18n'
import { KeyField } from './KeyField'
import { formatContext, headersToText, inputBase, parseHeaders } from './fields'
import { blankLocal, resolveDraft, type StatusState } from './providerDraft'
import { ProviderLogo } from './ProviderLogo'

export function ConfigBody({
  cfg,
  takenIds,
  status,
  setStatus,
  patchProvider,
  replaceConfig,
  onDelete,
}: {
  cfg: ProviderConfig
  /** 已被别的提供商占用的 id：用来拦住「切到已存在的预设」 */
  takenIds: string[]
  status: StatusState
  setStatus: (s: StatusState) => void
  patchProvider: (id: string, patch: Partial<ProviderConfig>) => void
  replaceConfig: (fromId: string, next: ProviderConfig) => void
  onDelete: (id: string, opts?: { silent?: boolean }) => void
}) {
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic')
  const [headerText, setHeaderText] = useState(() => headersToText(cfg.extraHeaders))
  const [fetched, setFetched] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [selectedFetched, setSelectedFetched] = useState('')
  const [manualModelId, setManualModelId] = useState('')
  const busy = status.kind === 'busy' || fetchingModels

  const preset = presetOf(cfg.id)
  const custom = isCustomConfig(cfg)
  const entries = modelEntriesOf(cfg)
  const headers = parseHeaders(headerText)
  const key = cfg.apiKey.trim()
  const protocol = protocolOf(cfg)
  const meta = COMPAT_META[protocol]
  const effectiveBaseUrl = baseUrlOf(cfg)
  const actualUrl = endpoint(effectiveBaseUrl, preset?.chatPath ?? meta.chatPath)

  /* ---- 预设 / 兼容格式切换 ---- */

  const switchPreset = (p: ProviderPreset) => {
    if (p.id === cfg.id) return
    if (takenIds.includes(p.id)) {
      setStatus({ kind: 'fail', msg: t('已经有一条「{0}」配置了，不能再切过来', p.label) })
      return
    }
    setStatus({ kind: 'idle' })
    replaceConfig(cfg.id, {
      id: p.id,
      kind: 'provider',
      label: '',
      baseUrl: '',
      apiKey: cfg.apiKey,
      models: cfg.models,
    })
    setStatus({ kind: 'ok', msg: t('已切换为 {0}', p.label) })
  }

  const switchCompat = (c: ProviderProtocol) => {
    setStatus({ kind: 'idle' })
    replaceConfig(cfg.id, {
      ...blankLocal(cfg.id, 'custom'),
      compat: c,
      apiKey: cfg.apiKey,
      models: cfg.models,
      baseUrl: cfg.baseUrl || COMPAT_META[c].defaultBaseUrl,
      label: custom ? cfg.label : '',
    })
    setStatus({ kind: 'ok', msg: t('已切换为 {0}', compatLabel(c)) })
  }

  /* ---- 模型管理 ---- */

  const addModel = (modelIdToAdd?: string) => {
    const id = (modelIdToAdd ?? manualModelId).trim()
    if (!id) {
      setStatus({ kind: 'fail', msg: t('请填写模型 ID') })
      return
    }
    if (entries.some((m) => m.id === id)) {
      setStatus({ kind: 'fail', msg: t('模型 ID「{0}」已存在', id) })
      return
    }
    const entry = makeModelEntry(id)
    patchProvider(cfg.id, { models: [...cfg.models, entry] })
    setManualModelId('')
    setStatus({ kind: 'ok', msg: t('已添加模型 {0}', id) })
  }

  const removeModel = (index: number) => {
    patchProvider(cfg.id, { models: cfg.models.filter((_, i) => i !== index) })
  }

  const setAsDefaultModel = (index: number) => {
    if (index === 0) return
    const target = cfg.models[index]
    const others = cfg.models.filter((_, i) => i !== index)
    patchProvider(cfg.id, { models: [target, ...others] })
  }

  const updateModel = (index: number, patch: Partial<ModelEntry>) => {
    patchProvider(cfg.id, { models: cfg.models.map((m, i) => (i === index ? { ...m, ...patch } : m)) })
  }

  const toggleModality = (index: number, m: InputModality) => {
    const cur = cfg.models[index]
    const has = cur.inputModalities.includes(m)
    if (m === 'text' && has) return
    updateModel(index, {
      inputModalities: has ? cur.inputModalities.filter((x) => x !== m) : [...cur.inputModalities, m],
    })
  }

  /* ---- 获取模型列表并自动生成配置 ---- */

  const runFetchModels = async (silent = false) => {
    if (fetchingModels) return
    if (headers.error) {
      if (!silent) setStatus({ kind: 'fail', msg: headers.error })
      return
    }
    setFetchingModels(true)
    if (!silent) setStatus({ kind: 'busy' })
    try {
      const ids = await listModelsWith(resolveDraft(cfg, headers.value))
      setFetched(ids)
      if (ids.length === 0) {
        if (!silent) {
          setStatus({
            kind: 'fail',
            msg: t('该提供商未返回任何模型，请在下方手动填写模型 ID'),
          })
        }
        return
      }

      // 如果当前尚未配置任何模型，自动为用户生成模型配置
      if (cfg.models.length === 0) {
        // 取前 8 个常用/可用模型自动生成，避免一次塞入上百个非对话模型
        const autoModels = ids.slice(0, 8).map((mid) => makeModelEntry(mid))
        patchProvider(cfg.id, { models: autoModels })
        setStatus({
          kind: 'ok',
          msg: t('已成功获取 {0} 个模型，并自动生成了推荐配置！', ids.length),
        })
      } else {
        setStatus({
          kind: 'ok',
          msg: t('已成功获取 {0} 个可用模型，可从下方快捷添加', ids.length),
        })
      }
    } catch (err) {
      if (!silent) {
        setStatus({
          kind: 'fail',
          msg: err instanceof AiRequestError ? err.message : t('获取模型失败，请检查 API 地址与 Key'),
        })
      }
    } finally {
      setFetchingModels(false)
    }
  }

  /* ---- 连通性测试 ---- */

  const runTest = async () => {
    if (!key || busy) return
    if (headers.error) {
      setStatus({ kind: 'fail', msg: headers.error })
      return
    }
    const model = modelsOf(cfg)[0]
    if (!model) {
      setStatus({ kind: 'fail', msg: t('请先配置至少一个模型，再测试连接') })
      return
    }
    setStatus({ kind: 'busy' })
    try {
      const text = await chatCompleteWith(resolveDraft(cfg, headers.value), model, {
        messages: [{ role: 'user', content: '测试连接' }],
        temperature: 0.5,
        purpose: 'test',
      })
      setStatus({ kind: 'ok', msg: text ? t('连接成功！模型响应正常') : t('连接成功') })
    } catch (err) {
      setStatus({ kind: 'fail', msg: err instanceof AiRequestError ? err.message : t('连接测试失败') })
    }
  }

  const extraHeaderField = (preset?.form ?? []).find((f) => f.key === 'extraHeaders')

  return (
    <div className="flex flex-col gap-4">
      {/* 头部 Hero 区域：官方 Logo、提供商名称、协议徽标、自动保存标识与快捷操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card/70 p-4 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line/80 bg-paper shadow-2xs">
            <ProviderLogo id={cfg.id} protocol={protocol} size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold text-ink-strong">{labelOf(cfg)}</h3>
              <span className="rounded-full bg-line/60 px-2 py-0.5 text-[10.5px] font-medium text-ink-soft">
                {t(compatLabel(protocol))}
              </span>
              <span className="flex items-center gap-1 text-[10.5px] text-ok-deep" title={t('改动会实时自动保存')}>
                <Check size={11} className="stroke-[2.5]" />
                {t('已自动保存')}
              </span>
            </div>
            <p className="mt-0.5 line-clamp-1 text-[11.5px] text-ink-faint">
              {t(preset?.note ?? meta.note)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {preset?.consoleUrl && (
            <a
              href={preset.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
            >
              <span>{t('申请 Key')}</span>
              <ExternalLink size={11} />
            </a>
          )}
          <button
            type="button"
            onClick={runTest}
            disabled={!key || busy}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[11.5px] font-medium text-ink transition hover:border-seal/50 hover:bg-seal/5 hover:text-seal-deep disabled:pointer-events-none disabled:opacity-40"
          >
            {busy && status.kind === 'busy' ? (
              <Loader2 size={12} className="animate-spin text-seal" />
            ) : (
              <PlugZap size={12} className="text-seal" />
            )}
            {t('测试连接')}
          </button>
        </div>
      </div>

      {/* 状态提示 */}
      {status.kind === 'ok' && (
        <div className="flex items-start gap-2 rounded-xl border border-ok-text/25 bg-ok-text/5 px-3.5 py-2 text-[12px] leading-relaxed text-ok-text">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{t(status.msg)}</span>
        </div>
      )}
      {status.kind === 'fail' && (
        <div className="flex items-start gap-2 rounded-xl border border-seal/25 bg-seal/5 px-3.5 py-2 text-[12px] leading-relaxed text-seal-deep">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{t(status.msg)}</span>
        </div>
      )}

      {/* 分栏 Tab：基础配置（新手友好） vs 高级配置 */}
      <div className="flex border-b border-line">
        <button
          type="button"
          onClick={() => setActiveTab('basic')}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-[12.5px] font-medium transition ${
            activeTab === 'basic'
              ? 'border-seal text-seal-deep'
              : 'border-transparent text-ink-soft hover:text-ink'
          }`}
        >
          <Sparkles size={13} />
          {t('基础配置')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('advanced')}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-[12.5px] font-medium transition ${
            activeTab === 'advanced'
              ? 'border-seal text-seal-deep'
              : 'border-transparent text-ink-soft hover:text-ink'
          }`}
        >
          <SlidersHorizontal size={13} />
          {t('高级配置')}
        </button>
      </div>

      {/* ==================== 1. 基础配置 ==================== */}
      {activeTab === 'basic' && (
        <div className="flex flex-col gap-4">
          {/* ① API Key & 接口地址 */}
          <div className="rounded-xl border border-line bg-card/50 p-4">
            <div className="grid grid-cols-1 gap-3.5">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="moji-field-apiKey" className="text-[12px] font-medium text-ink-strong">
                    API Key
                  </label>
                  {preset?.authHint && (
                    <span className="text-[11px] text-ink-faint">
                      {t('鉴权格式：')}<span className="font-mono">{t(preset.authHint)}</span>
                    </span>
                  )}
                </div>
                <KeyField
                  id="moji-field-apiKey"
                  value={cfg.apiKey}
                  onChange={(v) => {
                    patchProvider(cfg.id, { apiKey: v })
                    setStatus({ kind: 'idle' })
                  }}
                  onBlur={() => {
                    // 当填入 Key 且当前未配置模型时，自动探测拉取模型列表
                    if (cfg.apiKey.trim() && cfg.models.length === 0) {
                      void runFetchModels(true)
                    }
                  }}
                />
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  {t(preset?.setupHint ?? 'API Key 仅安全保存在您的本地设备上。')}
                </p>
              </div>

              {/* 接口地址 */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="moji-field-baseUrl" className="text-[12px] font-medium text-ink-strong">
                    {t('接口地址（API Base URL）')}
                  </label>
                  {!custom && (
                    <span className="text-[11px] text-ink-faint">
                      {t('官方地址已内置，如走私有中转或反代可直接在此修改')}
                    </span>
                  )}
                </div>
                <input
                  id="moji-field-baseUrl"
                  value={cfg.baseUrl}
                  onChange={(e) => {
                    patchProvider(cfg.id, { baseUrl: e.target.value })
                    setStatus({ kind: 'idle' })
                  }}
                  placeholder={custom ? meta.defaultBaseUrl : (preset?.baseUrl ?? meta.defaultBaseUrl)}
                  spellCheck={false}
                  className={`${inputBase} w-full font-mono text-[12px]`}
                  {...NO_AUTOFILL}
                />
              </div>
            </div>
          </div>

          {/* ② 模型列表配置（自动获取 + 简易选择） */}
          <div className="rounded-xl border border-line bg-card/50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-[12.5px] font-medium text-ink-strong">{t('模型配置')}</h4>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {t('排在第一位的模型将作为该提供商的默认模型')}
                </p>
              </div>

              <button
                type="button"
                onClick={() => runFetchModels(false)}
                disabled={fetchingModels || !key}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-seal-deep transition hover:border-seal/40 hover:bg-seal/5 disabled:opacity-40"
              >
                <RefreshCw size={12} className={fetchingModels ? 'animate-spin' : ''} />
                <span>{t('获取提供商模型列表')}</span>
              </button>
            </div>

            {/* 远端拉取到的可用模型快速添加条 */}
            {fetched.length > 0 && (
              <div className="mb-3.5 flex flex-wrap items-center gap-2 rounded-lg border border-seal/30 bg-seal/[0.03] p-2.5 text-[11.5px]">
                <span className="text-seal-deep font-medium">
                  {t('发现 {0} 个远端模型：', fetched.length)}
                </span>
                <select
                  value={selectedFetched}
                  onChange={(e) => setSelectedFetched(e.target.value)}
                  className="rounded border border-line bg-card px-2 py-1 font-mono text-[11.5px] text-ink outline-none"
                >
                  <option value="">{t('-- 选择要添加的模型 --')}</option>
                  {fetched
                    .filter((m) => !entries.some((e) => e.id === m))
                    .map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedFetched}
                  onClick={() => {
                    if (selectedFetched) {
                      addModel(selectedFetched)
                      setSelectedFetched('')
                    }
                  }}
                  className="rounded bg-seal px-2 py-1 font-medium text-paper transition hover:bg-seal-deep disabled:opacity-30"
                >
                  {t('加入列表')}
                </button>
              </div>
            )}

            {/* 已配置的模型列表 */}
            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-card/30 px-4 py-8 text-center">
                <p className="text-[12px] text-ink-soft">
                  {t('尚未配置任何模型')}
                </p>
                <p className="mt-1 text-[11px] text-ink-faint">
                  {key
                    ? t('点击上方「获取提供商模型列表」自动获取，或在下方手动输入模型 ID')
                    : t('请先在上方输入 API Key，然后点击「获取提供商模型列表」自动获取')}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {entries.map((m, i) => (
                  <li
                    key={`${m.id}-${i}`}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition ${
                      i === 0
                        ? 'border-seal/40 bg-seal/[0.04]'
                        : 'border-line bg-card hover:border-line-strong'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          i === 0 ? 'bg-seal text-paper' : 'bg-line/70 text-ink-soft'
                        }`}
                      >
                        {i === 0 ? t('默认主用') : `#${i + 1}`}
                      </span>
                      <span className="truncate font-mono text-[12px] font-medium text-ink-strong" title={m.id}>
                        {m.name ? `${m.name} (${m.id})` : m.id}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {i !== 0 && (
                        <button
                          type="button"
                          onClick={() => setAsDefaultModel(i)}
                          className="rounded px-2 py-0.5 text-[11px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
                        >
                          {t('设为默认')}
                        </button>
                      )}
                      <button
                        type="button"
                        title={t('移除该模型')}
                        onClick={() => removeModel(i)}
                        className="flex h-6 w-6 items-center justify-center rounded text-ink-faint transition hover:bg-seal/10 hover:text-seal"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* 手动添加模型输入框（极简） */}
            <div className="mt-3 flex items-center gap-2">
              <input
                value={manualModelId}
                onChange={(e) => setManualModelId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addModel()
                  }
                }}
                placeholder={t('手动输入模型 ID（如 deepseek-chat、gpt-4o）')}
                spellCheck={false}
                className={`${inputBase} min-w-0 flex-1 font-mono text-[12px]`}
                {...NO_AUTOFILL}
              />
              <button
                type="button"
                onClick={() => addModel()}
                disabled={!manualModelId.trim()}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-ink px-3.5 py-1.5 text-[11.5px] font-medium text-paper transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-35"
              >
                <Plus size={12} />
                <span>{t('添加模型')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 2. 高级配置 ==================== */}
      {activeTab === 'advanced' && (
        <div className="flex flex-col gap-4">
          {/* ① 切换预设或兼容协议 */}
          <div className="rounded-xl border border-line bg-card/50 p-4">
            <h4 className="mb-2 text-[12px] font-medium text-ink-strong">{t('更换预设与协议')}</h4>
            <div className="flex flex-wrap gap-1.5">
              {PROVIDERS.map((p) => {
                const on = cfg.id === p.id && !custom
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => !on && switchPreset(p)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] transition ${
                      on
                        ? 'border-seal/50 bg-seal/10 font-medium text-seal-deep'
                        : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    <ProviderLogo id={p.id} size={14} />
                    <span>{t(p.label)}</span>
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/70 pt-2.5">
              <span className="text-[11.5px] text-ink-soft">{t('自定义协议格式：')}</span>
              {COMPAT_PROTOCOLS.map((c) => {
                const on = custom && protocol === c
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => switchCompat(c)}
                    className={`rounded-lg border px-2.5 py-1 text-[11.5px] transition ${
                      on
                        ? 'border-seal/50 bg-seal/10 font-medium text-seal-deep'
                        : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    {t(compatLabel(c))}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ② 自定义显示名称 & 单轮 Token 限制 */}
          <div className="rounded-xl border border-line bg-card/50 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="moji-provider-name" className="mb-1.5 block text-[12px] font-medium text-ink-strong">
                  {t('显示别名')}
                </label>
                <input
                  id="moji-provider-name"
                  value={cfg.label}
                  onChange={(e) => patchProvider(cfg.id, { label: e.target.value })}
                  placeholder={preset?.label ?? t('例如：公司内网网关')}
                  className={`${inputBase} w-full text-[12px]`}
                  {...NO_AUTOFILL}
                />
              </div>

              <div>
                <label htmlFor="moji-field-maxTokens" className="mb-1.5 block text-[12px] font-medium text-ink-strong">
                  {t('单轮输出上限 (Max Tokens)')}
                </label>
                <input
                  id="moji-field-maxTokens"
                  type="number"
                  min={1}
                  value={cfg.maxTokens ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    patchProvider(cfg.id, { maxTokens: n > 0 ? Math.floor(n) : undefined })
                  }}
                  placeholder={preset?.maxTokens ? String(preset.maxTokens) : t('默认交给服务端')}
                  className={`${inputBase} w-full font-mono text-[12px]`}
                  {...NO_AUTOFILL}
                />
              </div>
            </div>
          </div>

          {/* ③ 额外请求头 */}
          <div className="rounded-xl border border-line bg-card/50 p-4">
            <label htmlFor="moji-field-extraHeaders" className="mb-1.5 block text-[12px] font-medium text-ink-strong">
              {t(extraHeaderField?.label ?? '自定义额外请求头 (JSON)')}
            </label>
            <textarea
              id="moji-field-extraHeaders"
              value={headerText}
              onChange={(e) => {
                setHeaderText(e.target.value)
                const parsed = parseHeaders(e.target.value)
                if (!parsed.error) patchProvider(cfg.id, { extraHeaders: parsed.value })
              }}
              rows={3}
              placeholder={extraHeaderField?.placeholder ?? '{\n  "X-Custom-Header": "value"\n}'}
              spellCheck={false}
              className={`${inputBase} w-full resize-y font-mono text-[11.5px] leading-relaxed`}
              {...NO_AUTOFILL}
            />
            {headers.error && <p className="mt-1 text-[11px] text-seal-deep">{t(headers.error)}</p>}
            <p className="mt-1 text-[11px] text-ink-faint">
              {t('部分特定网关要求附带应用来源或版本标识头，选填。')}
            </p>
            <div className="mt-2 text-[11px] text-ink-faint">
              {t('实际请求端点：')}<span className="font-mono text-ink-soft">{actualUrl}</span>
            </div>
          </div>

          {/* ④ 模型的高级能力微调（上下文与多模态） */}
          {entries.length > 0 && (
            <div className="rounded-xl border border-line bg-card/50 p-4">
              <h4 className="mb-2 text-[12px] font-medium text-ink-strong">{t('模型属性微调')}</h4>
              <div className="flex flex-col gap-2.5">
                {entries.map((m, i) => (
                  <div key={`adv-${m.id}-${i}`} className="rounded-lg border border-line bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[12px] font-medium text-ink-strong">{m.id}</span>
                      <span className="font-mono text-[11px] text-ink-faint">
                        {t('当前上下文：{0}', formatContext(m.contextWindow))}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-ink-faint">{t('快捷规格：')}</span>
                      {CONTEXT_PRESETS.map((c) => (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => updateModel(i, { contextWindow: c.value })}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] transition ${
                            m.contextWindow === c.value
                              ? 'border border-seal/40 bg-seal/10 text-seal-deep'
                              : 'border border-line bg-card text-ink-soft hover:border-seal/30'
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}

                      <div className="ml-auto flex items-center gap-1.5">
                        <span className="text-[11px] text-ink-faint">{t('模态：')}</span>
                        {ALL_MODALITIES.map((mod) => {
                          const on = m.inputModalities.includes(mod)
                          const locked = mod === 'text'
                          return (
                            <button
                              key={mod}
                              type="button"
                              disabled={locked}
                              onClick={() => toggleModality(i, mod)}
                              className={`rounded border px-1.5 py-0.5 text-[10.5px] transition ${
                                on
                                  ? 'border-seal/40 bg-seal/10 text-seal-deep'
                                  : 'border-line bg-card text-ink-faint'
                              } ${locked ? 'cursor-default opacity-70' : 'hover:border-line-strong'}`}
                            >
                              {on ? '✓ ' : ''}
                              {t(MODALITY_LABEL[mod])}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ⑤ 危险操作区域 */}
          <div className="flex items-center justify-between rounded-xl border border-seal/20 bg-seal/[0.02] p-4">
            <div>
              <div className="text-[12px] font-medium text-seal-deep">{t('删除此提供商')}</div>
              <div className="text-[11px] text-ink-faint">{t('删除后将从本地移除此配置及已配置的模型。')}</div>
            </div>
            <button
              type="button"
              onClick={() => onDelete(cfg.id)}
              className="flex items-center gap-1.5 rounded-lg border border-seal/30 bg-card px-3 py-1.5 text-[12px] font-medium text-seal transition hover:bg-seal/10 hover:text-seal-deep"
            >
              <Trash2 size={13} />
              <span>{t('确认删除')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

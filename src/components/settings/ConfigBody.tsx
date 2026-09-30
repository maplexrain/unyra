/**
 * 这个文件负责：单个提供商的配置表单：预设 / 兼容格式、名称、Key、模型列表与增删改。
 */

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, PlugZap, Plus, Trash2 } from 'lucide-react'
import {
  ALL_MODALITIES,
  CONTEXT_PRESETS,
  MODALITY_LABEL,
  baseUrlOf,
  isCustomConfig,
  makeModelEntry,
  modelEntriesOf,
  modelsOf,
  protocolOf,
  withKnownModelMeta,
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
  const [headerText, setHeaderText] = useState(() => headersToText(cfg.extraHeaders))
  const [fetched, setFetched] = useState<string[]>([])
  const [draftModel, setDraftModel] = useState<ModelEntry>(() => makeModelEntry(''))
  const busy = status.kind === 'busy'

  const preset = presetOf(cfg.id)
  const custom = isCustomConfig(cfg)
  const entries = modelEntriesOf(cfg)
  const headers = parseHeaders(headerText)
  const key = cfg.apiKey.trim()
  const protocol = protocolOf(cfg)
  const meta = COMPAT_META[protocol]
  const actualUrl = endpoint(baseUrlOf(cfg), preset?.chatPath ?? meta.chatPath)

  /* ---- 预设 / 兼容格式 ---- */

  const switchPreset = (p: ProviderPreset) => {
    if (p.id === cfg.id) return
    // 预设的 id 就是配置的 id：别家已经占了它就不能再切过去，
    // 否则两条配置共用一个 id，编辑会互相串
    if (takenIds.includes(p.id)) {
      setStatus({ kind: 'fail', msg: t('已经有一条「{0}」配置了，不能再切过来', p.label) })
      return
    }
    setStatus({ kind: 'idle' })
    // 换预设＝换一条配置（id 也要换，否则 presetOf 找不到它）
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

  /* ---- 模型增删改 ---- */

  const addModel = (raw?: string) => {
    const id = (raw ?? draftModel.id).trim()
    if (!id) {
      setStatus({ kind: 'fail', msg: t('请填写模型 ID') })
      return
    }
    if (entries.some((m) => m.id === id)) {
      setStatus({ kind: 'fail', msg: t('模型 ID「{0}」已存在', id) })
      return
    }
    // 键入的是预设已知模型时，自动补上上下文与模态
    const entry = withKnownModelMeta(cfg, raw ? makeModelEntry(id) : draftModel)
    patchProvider(cfg.id, { models: [...cfg.models, { ...entry, id }] })
    setDraftModel(makeModelEntry(''))
    setStatus({ kind: 'ok', msg: t('已添加模型 {0}', id) })
  }

  const updateModel = (index: number, patch: Partial<ModelEntry>) => {
    patchProvider(cfg.id, { models: cfg.models.map((m, i) => (i === index ? { ...m, ...patch } : m)) })
  }

  const removeModel = (index: number) => {
    patchProvider(cfg.id, { models: cfg.models.filter((_, i) => i !== index) })
  }

  const toggleModality = (index: number, m: InputModality) => {
    const cur = cfg.models[index]
    const has = cur.inputModalities.includes(m)
    if (m === 'text' && has) return
    updateModel(index, {
      inputModalities: has ? cur.inputModalities.filter((x) => x !== m) : [...cur.inputModalities, m],
    })
  }

  /* ---- 网络操作 ---- */

  const runTest = async () => {
    if (!key || busy) return
    if (headers.error) {
      setStatus({ kind: 'fail', msg: headers.error })
      return
    }
    const model = modelsOf(cfg)[0]
    if (!model) {
      setStatus({ kind: 'fail', msg: t('请先添加至少一个模型，再测试连接') })
      return
    }
    setStatus({ kind: 'busy' })
    try {
      const text = await chatCompleteWith(resolveDraft(cfg, headers.value), model, {
        messages: [{ role: 'user', content: '用一句话描写秋雨：' }],
        temperature: 0.8,
      })
      setStatus({ kind: 'ok', msg: text ? t('连接成功：{0}', text.slice(0, 40)) : t('连接成功') })
    } catch (err) {
      setStatus({ kind: 'fail', msg: err instanceof AiRequestError ? err.message : t('网络请求失败') })
    }
  }

  const runFetch = async () => {
    if (busy) return
    if (headers.error) {
      setStatus({ kind: 'fail', msg: headers.error })
      return
    }
    setStatus({ kind: 'busy' })
    try {
      const ids = await listModelsWith(resolveDraft(cfg, headers.value))
      if (!ids.length) {
        setStatus({ kind: 'fail', msg: t('该服务未返回可用模型，请手动填写模型 ID') })
        return
      }
      setFetched(ids)
      setStatus({ kind: 'ok', msg: t('已获取 {0} 个模型，点标签加入模型列表', ids.length) })
    } catch (err) {
      setStatus({ kind: 'fail', msg: err instanceof AiRequestError ? err.message : t('网络请求失败') })
    }
  }

  const extraHeaderField = (preset?.form ?? []).find((f) => f.key === 'extraHeaders')

  return (
    <>
      {/* ① 选择预设 */}
      <section>
        <div className="mb-1.5 text-ink-soft">
          {t('选择预设')}
          <span className="ml-2 text-[11px] text-ink-faint">{t('预设已内置接口地址，选了只需填 Key')}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDERS.map((p) => {
            const on = cfg.id === p.id && !custom
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => !on && switchPreset(p)}
                title={t(p.note)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${
                  on
                    ? 'border-seal/50 bg-seal/10 font-medium text-seal-deep'
                    : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'
                }`}
              >
                {t(p.label)}
              </button>
            )
          })}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card/60 px-3 py-2">
          <span className="text-[11.5px] text-ink-soft">{t('自定义兼容格式')}</span>
          {COMPAT_PROTOCOLS.map((c) => {
            const on = custom && protocol === c
            return (
              <button
                key={c}
                type="button"
                title={t(COMPAT_META[c].note)}
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
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          {t(custom ? meta.note : (preset?.note ?? ''))}
        </p>
      </section>

      {/* ② 名称 */}
      <section>
        <label htmlFor="moji-provider-name" className="mb-1.5 block text-ink-soft">
          {t('名称')}
          <span className="ml-2 text-[11px] text-ink-faint">
            {custom ? t('给这家提供商起个名字') : t('可留空，默认显示预设名')}
          </span>
        </label>
        <input
          id="moji-provider-name"
          value={cfg.label}
          onChange={(e) => patchProvider(cfg.id, { label: e.target.value })}
          placeholder={t(preset?.label ?? '例如：公司内网网关')}
          className={`${inputBase} w-full`}
          {...NO_AUTOFILL}
        />
      </section>

      {/* ③ 接入参数 */}
      <section className="grid grid-cols-1 gap-3">
        {/* 只有自定义才要填地址；预设已内置 */}
        {custom && (
          <div>
            <label htmlFor="moji-field-baseUrl" className="mb-1.5 block text-ink-soft">
              {t('接口地址')}
            </label>
            <input
              id="moji-field-baseUrl"
              value={cfg.baseUrl}
              onChange={(e) => patchProvider(cfg.id, { baseUrl: e.target.value })}
              placeholder={meta.defaultBaseUrl}
              spellCheck={false}
              className={`${inputBase} w-full font-mono`}
              {...NO_AUTOFILL}
            />
                {meta.form.find((f) => f.key === 'baseUrl')?.warning && (
              <p className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-warn/30 bg-warn/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-warn-text">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {t(meta.form.find((f) => f.key === 'baseUrl')?.warning ?? '')}
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="moji-field-apiKey" className="mb-1.5 block text-ink-soft">
            API Key
          </label>
          <KeyField id="moji-field-apiKey" value={cfg.apiKey} onChange={(v) => patchProvider(cfg.id, { apiKey: v })} />
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
            {t('鉴权：')}<span className="font-mono">{t(meta.authHint)}</span>
          </p>
          {preset?.setupHint && (
            <p className="mt-1.5 rounded-lg border border-line bg-card/60 px-2.5 py-2 text-[11px] leading-relaxed text-ink-soft">
              {t(preset.setupHint)}
            </p>
          )}
          {preset?.consoleUrl && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              {t('申请 Key：')}
              <a
                href={preset.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="text-seal-deep underline decoration-seal/40 underline-offset-2 hover:decoration-seal"
              >
                {new URL(preset.consoleUrl).host}
              </a>
            </p>
          )}
        </div>

        {/* 预设声明的额外字段 */}
        {(preset?.form ?? [])
          .filter((f) => f.key === 'maxTokens')
          .map((f) => (
            <div key="maxTokens">
              <label htmlFor="moji-field-maxTokens" className="mb-1.5 block text-ink-soft">
                {t(f.label)}
                {f.optional && <span className="ml-2 text-[11px] text-ink-faint">{t('选填')}</span>}
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
                placeholder={preset?.maxTokens ? String(preset.maxTokens) : ''}
                className={`${inputBase} w-full font-mono`}
                {...NO_AUTOFILL}
              />
              {f.hint && <p className="mt-1 text-[11px] text-ink-faint">{t(f.hint)}</p>}
            </div>
          ))}

        {/* 额外请求头：预设声明了、或是自定义提供商时显示 */}
        {(extraHeaderField || custom) && (
          <div>
            <label htmlFor="moji-field-extraHeaders" className="mb-1.5 block text-ink-soft">
              {t(extraHeaderField?.label ?? '额外请求头')}
              <span className="ml-2 text-[11px] text-ink-faint">{t('选填，JSON 对象')}</span>
            </label>
            <textarea
              id="moji-field-extraHeaders"
              value={headerText}
              onChange={(e) => {
                setHeaderText(e.target.value)
                const parsed = parseHeaders(e.target.value)
                // 只在解析成功时写回草稿，非法中间态留在文本里
                if (!parsed.error) patchProvider(cfg.id, { extraHeaders: parsed.value })
              }}
              rows={3}
              placeholder={extraHeaderField?.placeholder ?? '{ "X-Custom-Header": "value" }'}
              spellCheck={false}
              className={`${inputBase} w-full resize-y font-mono leading-relaxed`}
              {...NO_AUTOFILL}
            />
            {headers.error && <p className="mt-1 text-[11px] text-seal-deep">{t(headers.error)}</p>}
            {extraHeaderField?.hint && <p className="mt-1 text-[11px] text-ink-faint">{t(extraHeaderField.hint)}</p>}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-ink-faint">
          {t('实际请求')} <span className="font-mono">{actualUrl}</span>
        </p>
      </section>

      {/* ④ 模型列表 */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-ink-soft">
            {t('模型列表')}
            <span className="ml-2 text-[11px] text-ink-faint">{t('第一个为该提供商的默认模型')}</span>
          </span>
          <button
            type="button"
            onClick={runFetch}
            disabled={busy}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-seal-deep disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
            {t('获取模型列表')}
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11.5px] text-ink-faint">
            {t('还没有模型。在下面填一个，或用「获取模型列表」从服务端拉取。')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((m, i) => (
              <li key={`${m.id}-${i}`} className="rounded-xl border border-line bg-card px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                      i === 0 ? 'bg-seal/10 text-seal-deep' : 'bg-line/70 text-ink-soft'
                    }`}
                  >
                    {i === 0 ? t('默认') : `#${i + 1}`}
                  </span>
                  <input
                    value={m.name}
                    onChange={(e) => updateModel(i, { name: e.target.value })}
                    placeholder={t('显示名（留空用 ID）')}
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] text-ink-strong outline-none transition hover:border-line focus:border-seal/50 focus:bg-paper"
                    {...NO_AUTOFILL}
                  />
                  <button
                    type="button"
                    title={t('移除此模型')}
                    onClick={() => removeModel(i)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-seal/10 hover:text-seal"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="min-w-0">
                    <span className="mb-0.5 block text-[10.5px] text-ink-faint">{t('模型 ID')}</span>
                    <input
                      value={m.id}
                      onChange={(e) => updateModel(i, { id: e.target.value })}
                      placeholder="deepseek-chat"
                      spellCheck={false}
                      className={`${inputBase} w-full py-1.5 font-mono text-[11.5px]`}
                      {...NO_AUTOFILL}
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="mb-0.5 block text-[10.5px] text-ink-faint">{t('模型上下文')}</span>
                    <input
                      type="number"
                      min={0}
                      value={m.contextWindow || ''}
                      onChange={(e) => updateModel(i, { contextWindow: Number(e.target.value) || 0 })}
                      placeholder="128000"
                      className={`${inputBase} w-full py-1.5 font-mono text-[11.5px]`}
                      {...NO_AUTOFILL}
                    />
                  </label>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] text-ink-faint">{t('多模态能力')}</span>
                  {ALL_MODALITIES.map((mod) => {
                    const on = m.inputModalities.includes(mod)
                    const locked = mod === 'text'
                    return (
                      <button
                        key={mod}
                        type="button"
                        disabled={locked}
                        onClick={() => toggleModality(i, mod)}
                        title={locked ? t('所有模型都支持文本') : undefined}
                        className={`rounded-md border px-1.5 py-0.5 text-[10.5px] transition ${
                          on ? 'border-seal/40 bg-seal/10 text-seal-deep' : 'border-line bg-card text-ink-faint'
                        } ${locked ? 'cursor-default opacity-70' : 'hover:border-line-strong'}`}
                      >
                        {on ? '✓ ' : ''}
                        {t(MODALITY_LABEL[mod])}
                      </button>
                    )
                  })}
                  <span className="ml-auto font-mono text-[10.5px] text-ink-faint">
                    {t('上下文 {0}', formatContext(m.contextWindow))}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* 新增模型 */}
        <div className="mt-2 rounded-xl border border-dashed border-line-strong bg-card/40 px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-soft">
            <Plus size={12} />
            {t('添加模型')}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={draftModel.id}
              onChange={(e) => setDraftModel((m) => ({ ...m, id: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addModel()
                }
              }}
              placeholder={t('模型 ID（必填）')}
              spellCheck={false}
              className={`${inputBase} w-full py-1.5 font-mono text-[11.5px]`}
              {...NO_AUTOFILL}
            />
            <input
              value={draftModel.name}
              onChange={(e) => setDraftModel((m) => ({ ...m, name: e.target.value }))}
              placeholder={t('模型名称（选填）')}
              className={`${inputBase} w-full py-1.5 text-[11.5px]`}
              {...NO_AUTOFILL}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={draftModel.contextWindow || ''}
              onChange={(e) => setDraftModel((m) => ({ ...m, contextWindow: Number(e.target.value) || 0 }))}
              placeholder={t('模型上下文（token）')}
              className={`${inputBase} w-[190px] py-1.5 font-mono text-[11.5px]`}
              {...NO_AUTOFILL}
            />
            <span className="text-[10.5px] text-ink-faint">{t('快捷填入')}</span>
            {CONTEXT_PRESETS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setDraftModel((m) => ({ ...m, contextWindow: c.value }))}
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] transition ${
                  draftModel.contextWindow === c.value
                    ? 'border-seal/40 bg-seal/10 text-seal-deep'
                    : 'border-line bg-card text-ink-soft hover:border-seal/40 hover:text-seal-deep'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10.5px] text-ink-faint">多模态能力</span>
            {ALL_MODALITIES.map((mod) => {
              const on = draftModel.inputModalities.includes(mod)
              const locked = mod === 'text'
              return (
                <button
                  key={mod}
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    setDraftModel((m) => ({
                      ...m,
                      inputModalities: on ? m.inputModalities.filter((x) => x !== mod) : [...m.inputModalities, mod],
                    }))
                  }
                  className={`rounded-md border px-1.5 py-0.5 text-[10.5px] transition ${
                    on ? 'border-seal/40 bg-seal/10 text-seal-deep' : 'border-line bg-card text-ink-faint'
                  } ${locked ? 'cursor-default opacity-70' : 'hover:border-line-strong'}`}
                >
                  {on ? '✓ ' : ''}
                  {t(MODALITY_LABEL[mod])}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => addModel()}
              disabled={!draftModel.id.trim()}
              className="ml-auto shrink-0 rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-medium text-paper transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-35"
            >
              {t('添加')}
            </button>
          </div>

          {preset && preset.knownModels.length > 0 && (
            <div className="mt-2 border-t border-line pt-2">
              <span className="text-[10.5px] text-ink-faint">{t('{0} 的常见模型（点击直接加入）', t(preset.label))}</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {preset.knownModels
                  .filter((k) => !entries.some((m) => m.id === k.id))
                  .map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => addModel(k.id)}
                      className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft transition hover:border-seal/50 hover:text-seal-deep"
                    >
                      + {k.id}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {fetched.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-ink-soft">
                {t('远端返回 {0} 个模型，点标签加入', fetched.length)}
              </summary>
              <div className="mt-1.5 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                {fetched
                  .filter((id) => !entries.some((m) => m.id === id))
                  .map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => addModel(id)}
                      className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft transition hover:border-seal/50 hover:text-seal-deep"
                    >
                      + {id}
                    </button>
                  ))}
              </div>
            </details>
          )}
        </div>
      </section>

      {/* 操作 */}
      <section className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={runTest}
          disabled={!key || busy}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-seal/50 hover:text-seal-deep disabled:pointer-events-none disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
          {t('测试连接')}
        </button>
        <button
          type="button"
          onClick={() => onDelete(cfg.id)}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-seal/40 hover:text-seal-deep"
        >
          <Trash2 size={13} />
          {t('删除该提供商')}
        </button>
      </section>

      {status.kind === 'ok' && (
        <div className="flex items-start gap-2 rounded-lg border border-ok-text/25 bg-ok-text/5 px-3 py-2 text-[11.5px] leading-relaxed text-ok-text">
          <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{t(status.msg)}</span>
        </div>
      )}
      {status.kind === 'fail' && (
        <div className="flex items-start gap-2 rounded-lg border border-seal/25 bg-seal/5 px-3 py-2 text-[11.5px] leading-relaxed text-seal-deep">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{t(status.msg)}</span>
        </div>
      )}
    </>
  )
}

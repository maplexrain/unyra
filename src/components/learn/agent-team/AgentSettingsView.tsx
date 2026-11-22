/**
 * 智能体的**独立设置页**：agent team 中央工作区在「设置态」下替换对话流的那一块
 * （AgentSlot 的 settingsAgent 状态控制，见 workspace/AgentSlot）。
 *
 * 管的是「这位声部自己」：名字与头像、跑在哪家提供商-模型上、思考档位、
 * execute 开放哪些 api 组、能触发哪些工作流，以及只读查看它实际会收到的系统提示词。
 * 每个字段都遵循 agent/agentProfile 的缺省语义：没改过 = 跟随默认 / 全局，
 * 改过才落盘；「恢复默认」整条清除覆盖。
 *
 * 与全局的「超级导师设置」（AgentSettingsPanel，管人格 / 技能 / MCP / 权限这些
 * 导师层面的机制）是两回事：这里是按声部逐个配的「它自己是谁、用什么跑」。
 */

import { createElement, useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, Check, Copy, GraduationCap, MessageSquare, RotateCcw } from 'lucide-react'
import { REASONING_EFFORTS, REASONING_HINT, REASONING_LABEL, type ReasoningEffort } from '../../../ai/types'
import {
  globalProvider,
  globalEffort,
  isConfigured,
  labelOf,
  loadAiSettings,
  modelsOf,
  subscribeAiSettings,
} from '../../../ai/settings'
import { SANDBOX_API_CATALOG } from '../../../agent/apiCatalog'
import { docFormatOf } from '../../../agent/docFormat'
import { personaOf } from '../../../agent/persona'
import {
  AGENT_API_PLANES,
  AGENT_AVATARS,
  AGENT_WORKFLOW_PLANES,
  DEFAULT_AGENT_NAME,
  FREE_AGENT_API_ITEMS,
  type AgentProfile,
  type AgentVoice,
} from '../../../agent/agentProfile'
import { loadAgentSettings, subscribeAgentSettings } from '../../../agent/settings'
import { buildFreeChatSystem, buildVoiceSystem } from '../../../learn/ai'
import { t, useLocale } from '../../../i18n'
import { builtinWorkflowRows, type WorkflowRow } from '../../../learn/workflows'
import { agentAvatarIcon } from './agentAvatars'
import type { AgentTeamMode } from './conversationList'

export interface AgentSettingsViewProps {
  agentId: AgentTeamMode
  /** 这位声部当前的 profile（AgentSlot 从 agentSettings 现取） */
  profile: AgentProfile
  /** 合并一段覆盖（undefined 字段 = 清除该覆盖）；落盘与广播由调用方完成 */
  onChange: (patch: Partial<AgentProfile>) => void
  /** 整条恢复默认 */
  onReset: () => void
  /** 关闭设置页，回到对话流 */
  onClose: () => void
  /** 工作流清单（导师 = 当前目标作用域的内置 + 全局 + 目标级） */
  flowRows: WorkflowRow[]
}

/** 分节标题：一行标题 + 一句口径说明（高密度行式，不加卡片底） */
function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2.5">
      <h3 className="text-[13px] font-semibold text-ink-strong">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{hint}</p>}
    </div>
  )
}

/**
 * 白名单编辑器（「添加可选项到列表实现启用」，工作流节专用）：
 * - **内置项**（item.builtin）恒开放、只读锁死：始终渲染在列表顶部（「内置 · 恒开放」
 *   徽标），没有移除按钮、也不进添加下拉——不允许卸载；
 * - profile 没写清单（undefined）= 默认全开（除内置项外），只显示口径说明与添加下拉；
 * - 从默认态第一次添加起，**列表即启用白名单**——只有列出的项可用，未列出的关闭；
 *   行上的 × 逐项移除，全移除 = 白名单为空（除内置项外全关）；
 * - 「恢复全部可用」整条清掉清单，回到 undefined 的默认态。
 * （execute api 节曾是它的第二个使用方；能力面定稿为架构固定后，api 节改为纯只读清单。）
 */
function AllowListEditor(props: {
  items: ReadonlyArray<{ key: string; label: string; tag?: string; builtin?: boolean }>
  selected: readonly string[] | undefined
  onChange: (list: string[] | undefined) => void
  addLabel: string
  /** 添加下拉的测试钩子：'api' → data-api-add；'wf' → data-wf-add */
  addHook: 'api' | 'wf'
  emptyNote: string
  clearedNote: string
  clearLabel: string
}) {
  const builtinItems = props.items.filter((i) => i.builtin)
  const userItems = props.items.filter((i) => !i.builtin)
  const isDefault = props.selected === undefined
  // 用户清单里混进的内置 id 视为冗余（内置恒开），不显示为可移除行
  const userList = (props.selected ?? []).filter((k) => !builtinItems.some((i) => i.key === k))
  const remaining = userItems.filter((i) => !userList.includes(i.key))
  return (
    <div className="flex flex-col gap-2">
      {/* 内置项：恒开放、只读（不允许卸载） */}
      {builtinItems.length > 0 && (
        <ul className="flex flex-col divide-y divide-line/50 rounded-lg border border-line/70 bg-paper-deep/30">
          {builtinItems.map((item) => (
            <li key={item.key} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">
                {t(item.label)}
              </span>
              {item.tag && (
                <span className="shrink-0 rounded bg-line/60 px-1.5 py-px text-[10px] text-ink-faint">
                  {t(item.tag)}
                </span>
              )}
              <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                {t('内置 · 恒开放')}
              </span>
              <code className="shrink-0 text-[10px] text-ink-faint">{item.key}</code>
            </li>
          ))}
        </ul>
      )}
      {isDefault ? (
        <p className="rounded-lg border border-line/70 bg-paper-deep/40 px-3 py-2 text-[11.5px] leading-relaxed text-ink-faint">
          {t(props.emptyNote)}
        </p>
      ) : userList.length === 0 ? (
        <p className="rounded-lg border border-line/70 bg-paper-deep/40 px-3 py-2 text-[11.5px] leading-relaxed text-ink-faint">
          {t(props.clearedNote)}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/50 rounded-lg border border-line/70">
          {userList.map((key) => {
            const item = props.items.find((i) => i.key === key)
            return (
              <li key={key} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-strong">
                  {item ? t(item.label) : key}
                </span>
                {item?.tag && (
                  <span className="shrink-0 rounded bg-line/60 px-1.5 py-px text-[10px] text-ink-faint">
                    {t(item.tag)}
                  </span>
                )}
                <code className="shrink-0 text-[10px] text-ink-faint">{key}</code>
                <button
                  type="button"
                  aria-label={`${t('移除')} ${key}`}
                  title={t('移除')}
                  onClick={() => props.onChange(userList.filter((k) => k !== key))}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-seal/15 hover:text-seal-deep"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex items-center gap-2">
        {remaining.length > 0 && (
          <select
            {...(props.addHook === 'api' ? { 'data-api-add': 'true' } : { 'data-wf-add': 'true' })}
            aria-label={props.addLabel}
            value=""
            onChange={(e) => {
              const v = e.target.value
              if (v) props.onChange([...(props.selected ?? []).filter((k) => !builtinItems.some((i) => i.key === k)), v])
            }}
            className={selectClass + ' max-w-[340px]'}
          >
            <option value="">{t('添加…')}</option>
            {remaining.map((i) => (
              <option key={i.key} value={i.key}>
                {t(i.label)}
                {i.tag ? `（${t(i.tag)}）` : ''}
              </option>
            ))}
          </select>
        )}
        {!isDefault && (
          <button
            type="button"
            onClick={() => props.onChange(undefined)}
            className="rounded-lg px-2 py-1 text-[11px] text-ink-faint transition hover:bg-line/50 hover:text-ink"
          >
            {t(props.clearLabel)}
          </button>
        )}
      </div>
    </div>
  )
}

const selectClass =
  'min-w-0 rounded-lg border border-line bg-card px-2 py-1.5 text-[12px] text-ink-strong outline-none transition hover:border-line-strong focus:border-seal/60'

export function AgentSettingsView({
  agentId,
  profile,
  onChange,
  onReset,
  onClose,
  flowRows,
}: AgentSettingsViewProps) {
  useLocale()
  const isTutor = agentId === 'tutor'
  const isFree = agentId === 'free'
  /** 承接声部（出卷师 / 设计师 / 调研员 / 维修员）：api 与工作流面都是团队分工固定的只读清单 */
  const isSpecialist = !isTutor && !isFree
  const agentSettings = useSyncExternalStore(subscribeAgentSettings, loadAgentSettings)
  const ai = useSyncExternalStore(subscribeAiSettings, loadAiSettings)

  /* ---------- 身份 ---------- */
  const displayName = profile.name?.trim() || t(DEFAULT_AGENT_NAME[agentId])
  // 图标组件取自固定映射（引用稳定）；小写 + createElement 是为了让 react-compiler
  // 认得出这不是「渲染期造组件」（static-components 规则会掐掉优化）
  const avatarIcon = agentAvatarIcon(profile.avatar, agentId === 'free' ? MessageSquare : GraduationCap)

  /* ---------- 提供商 · 模型 ---------- */
  const globalProv = globalProvider(ai)
  const profileProv = profile.providerId?.trim()
    ? ai.providers.find((p) => p.id === profile.providerId?.trim())
    : undefined
  const effectiveProv = profileProv ?? globalProv
  const modelOptions = effectiveProv ? modelsOf(effectiveProv) : []
  const effectiveModelLabel =
    profile.model?.trim() && modelOptions.includes(profile.model.trim())
      ? profile.model.trim()
      : t('该提供商默认（第一个）')

  /* ---------- 思考档位 ---------- */
  const effortValue = profile.effort ?? ''

  /* ---------- execute api（能力面由架构固定：全部恒开放、纯只读清单） ---------- */
  /**
   * execute 的 api 能力面：按声部的团队分工（AGENT_API_PLANES）固定的只读清单。
   * 执行控制原语（core 组是顶层函数，不在目录里，单独一行——目录里的 core 过滤掉防重名）。
   */
  const apiItems: Array<{ key: string; label: string; builtin?: boolean }> = isFree
    ? FREE_AGENT_API_ITEMS.map((key) => ({
        key,
        label: key === 'web' ? t('联网搜索与抓取') : t('日程提醒'),
        builtin: true,
      }))
    : [
        { key: 'core', label: '执行控制（顶层函数）', builtin: true },
        ...SANDBOX_API_CATALOG.filter(
          (g) => g.key !== 'core' && AGENT_API_PLANES[agentId as AgentVoice].groups.includes(g.key),
        ).map((g) => ({ key: g.key, label: g.label, builtin: true })),
      ]
  /* ---------- 工作流（导师可配白名单；承接声部 = 分工固定的只读面） ---------- */
  const wfPlane = new Set(AGENT_WORKFLOW_PLANES[agentId as AgentVoice])
  // 内置行的锁死口径 = 本声部的分工面：不在面上的内置规程它触发不了，干脆不展示
  //（免得进了「添加」下拉、加了又被通道口拒绝）
  const wfItems = flowRows
    .filter((r) => r.tier !== 'builtin' || wfPlane.has(r.id))
    .map((r) => ({
      key: r.id,
      label: r.name,
      tag: r.tier === 'builtin' ? '内置' : r.tier === 'global' ? '全局' : '目标级',
      builtin: r.tier === 'builtin',
    }))
  /** 承接声部的固定工作流面（只有内置规程，没有登记条目） */
  const specialistWfItems = builtinWorkflowRows()
    .filter((r) => wfPlane.has(r.id))
    .map((r) => ({ key: r.id, label: r.name, tag: '内置' as const, builtin: true }))

  /* ---------- 系统提示词（只读） ---------- */
  const extra =
    agentSettings.extraSystemPromptEnabled && agentSettings.extraSystemPrompt?.trim()
      ? agentSettings.extraSystemPrompt.trim()
      : undefined
  /**
   * 系统提示词的只读预览：execute 能力面由架构固定（全部恒开放），提示词恒为全量——
   * 与 assembleTurnEntry 落进新对话的合成同一条路径。工作流规程同样是内置恒在场。
   */
  const systemPrompt = useMemo(
    () =>
      isFree
        ? buildFreeChatSystem({ extraSystemPrompt: extra })
        : buildVoiceSystem(agentId, { extraSystemPrompt: extra }),
    [isFree, agentId, extra],
  )
  const [copied, setCopied] = useState(false)
  const copyPrompt = (): void => {
    void navigator.clipboard
      .writeText(systemPrompt)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper">
      {/* 抬头：返回对话 + 这位智能体的身份 + 恢复默认 */}
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-ink-soft transition hover:bg-line/50 hover:text-ink-strong"
        >
          <ArrowLeft size={13} />
          <span>{t('返回对话')}</span>
        </button>
        <span aria-hidden="true" className="h-4 w-px bg-line" />
        {createElement(avatarIcon, { size: 14, className: 'shrink-0 text-seal' })}
        <span className="truncate text-[13px] font-semibold text-ink-strong">{displayName}</span>
        <span className="shrink-0 text-[11px] text-ink-faint">· {t('智能体设置')}</span>
        <button
          type="button"
          onClick={onReset}
          title={t('清除这位智能体的全部覆盖，回到默认')}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
        >
          <RotateCcw size={12} />
          <span>{t('恢复默认')}</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[880px] flex-col px-6 py-1">
          {/* ---------- 身份 ---------- */}
          <section className="border-b border-line/60 py-4">
            <SectionHead title={t('身份')} hint={t('改的是 agent team 左栏与这里的显示；不影响对话内容。')} />
            <div className="flex flex-col gap-2.5">
              <label className="flex items-center gap-2.5">
                <span className="w-14 shrink-0 text-[12px] text-ink-soft">{t('名称')}</span>
                <input
                  type="text"
                  value={profile.name ?? ''}
                  placeholder={t(DEFAULT_AGENT_NAME[agentId])}
                  onChange={(e) => onChange({ name: e.target.value })}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink-strong outline-none transition placeholder:text-ink-faint hover:border-line-strong focus:border-seal/60"
                />
              </label>
              <div className="flex items-start gap-2.5">
                <span className="w-14 shrink-0 pt-1.5 text-[12px] text-ink-soft">{t('头像')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {AGENT_AVATARS.map((a) => {
                    const Icon = agentAvatarIcon(a.id, MessageSquare)
                    const on = (profile.avatar ?? '') === a.id
                    return (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={on}
                        title={t(a.label)}
                        onClick={() => onChange({ avatar: on ? undefined : a.id })}
                        className={
                          'flex h-8 w-8 items-center justify-center rounded-lg border transition ' +
                          (on
                            ? 'border-seal/60 bg-seal/10 text-seal'
                            : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink')
                        }
                      >
                        <Icon size={15} />
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ---------- 提供商 · 模型 ---------- */}
          <section className="border-b border-line/60 py-4">
            <SectionHead
              title={t('提供商 · 模型')}
              hint={t('这位智能体自己的模型选择；没改就跟随全局默认。改下一轮生效，进行中的对话不受影响。')}
            />
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5">
                <span className="w-14 shrink-0 text-[12px] text-ink-soft">{t('提供商')}</span>
                <select
                  value={profile.providerId ?? ''}
                  onChange={(e) => onChange({ providerId: e.target.value || undefined, model: undefined })}
                  className={selectClass + ' max-w-[320px] flex-1'}
                >
                  <option value="">{t('跟随全局')}（{globalProv ? labelOf(globalProv) : t('未配置')}）</option>
                  {ai.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {labelOf(p)}
                      {isConfigured(p) ? '' : t('（未配置 Key）')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="w-14 shrink-0 text-[12px] text-ink-soft">{t('模型')}</span>
                <select
                  value={profile.model?.trim() ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) {
                      onChange({ model: undefined })
                      return
                    }
                    // 跟随全局提供商时选定模型：把提供商一并钉住，免得全局切换后覆盖悄悄失效
                    onChange(profileProv ? { model: v } : { providerId: effectiveProv?.id, model: v })
                  }}
                  className={selectClass + ' max-w-[320px] flex-1'}
                >
                  <option value="">{t('跟随全局')}（{effectiveModelLabel}）</option>
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">
                  {effectiveProv
                    ? `${t('生效')}: ${labelOf(effectiveProv)} · ${profile.model?.trim() || t('默认模型')}`
                    : t('尚未配置任何提供商')}
                </span>
              </div>
            </div>
          </section>

          {/* ---------- 思考档位 ---------- */}
          <section className="border-b border-line/60 py-4">
            <SectionHead
              title={t('思考强度')}
              hint={t(
                '这位智能体自己的档位；没改就跟随全局滑条。注意：换档可能整体更换服务商的缓存引擎，已有长对话的前缀缓存会重置。',
              )}
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={effortValue === ''}
                onClick={() => onChange({ effort: undefined })}
                className={
                  'rounded-lg border px-3 py-1.5 text-[12px] transition ' +
                  (effortValue === ''
                    ? 'border-seal/60 bg-seal/10 font-medium text-seal'
                    : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink')
                }
              >
                {t('跟随全局')}（{REASONING_LABEL[globalEffort(ai)]}）
              </button>
              {REASONING_EFFORTS.map((e) => {
                const on = effortValue === e
                return (
                  <button
                    key={e}
                    type="button"
                    aria-pressed={on}
                    title={t(REASONING_HINT[e])}
                    onClick={() => onChange({ effort: e as ReasoningEffort })}
                    className={
                      'rounded-lg border px-3 py-1.5 text-[12px] transition ' +
                      (on
                        ? 'border-seal/60 bg-seal/10 font-medium text-seal'
                        : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink')
                    }
                  >
                    {REASONING_LABEL[e]}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ---------- execute 开放的 api（能力面固定：纯只读清单，不可增删） ---------- */}
          <section className="border-b border-line/60 py-4">
            <SectionHead
              title={t('execute 开放的 api')}
              hint={
                isFree
                  ? t('仅聊天的沙箱只有联网与日程两组能力，由架构固定、恒开放。')
                  : isTutor
                    ? t('导师的 api 面按团队分工固定、只读（不可增删）：教学主线与协调的全量基座；路由与分派归调度员、联网与浏览器归调研员、课件与实验归设计师、出卷与阅卷归出卷师、修复归维修员。')
                    : t('这位成员的 api 面由团队分工固定、只读（不可增删）：它只拿职责所需的能力，其余域通过 team.* 协作补齐。')
              }
            />
            <ul className="flex flex-col divide-y divide-line/50 rounded-lg border border-line/70 bg-paper-deep/30">
              {apiItems.map((item) => (
                <li key={item.key} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">
                    {t(item.label)}
                  </span>
                  <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    {t('内置 · 恒开放')}
                  </span>
                  <code className="shrink-0 text-[10px] text-ink-faint">{item.key}</code>
                </li>
              ))}
            </ul>
          </section>

          {/* ---------- 集成的工作流 ---------- */}
          <section className="border-b border-line/60 py-4">
            <SectionHead
              title={t('集成的工作流')}
              hint={
                isFree
                  ? t('自由聊天的沙箱没有工作流通道（wf.*），此设置不生效。')
                  : isTutor
                    ? t('从下拉把允许触发的工作流添加进列表。本声部分工面里的内置规程恒开放、只读不可卸载；白名单只管登记的全局 / 目标级工作流——wf.list 只列出的，越权触发当场拒绝。')
                    : t('这位成员的工作流面由团队分工固定、只读（不可增删）；登记的全局 / 目标级工作流只有导师能触发。')
              }
            />
            {isTutor ? (
              <AllowListEditor
                items={wfItems}
                selected={profile.workflows}
                onChange={(list) => onChange({ workflows: list })}
                addLabel={t('添加工作流')}
                addHook="wf"
                emptyNote="未添加任何项：登记的工作流全部可用（本声部的内置规程面恒开放）。"
                clearedNote="列表为空：分工面内的内置规程恒可用，登记的全局 / 目标级工作流全部关闭。"
                clearLabel="恢复全部可用"
              />
            ) : isSpecialist ? (
              <ul className="flex flex-col divide-y divide-line/50 rounded-lg border border-line/70 bg-paper-deep/30">
                {specialistWfItems.map((item) => (
                  <li key={item.key} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">
                      {t(item.label)}
                    </span>
                    <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      {t('内置 · 恒开放')}
                    </span>
                    <code className="shrink-0 text-[10px] text-ink-faint">{item.key}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-line/70 bg-paper-deep/40 px-3 py-2 text-[11.5px] leading-relaxed text-ink-faint">
                {t('自由聊天没有接工作流通道；需要出卷、开讲这类流程时，请用「导师」。')}
              </p>
            )}
          </section>

          {/* ---------- 系统提示词（只读） ---------- */}
          <section className="py-4">
            <SectionHead
              title={t('系统提示词')}
              hint={
                isFree
                  ? t('自由聊天**下一轮**将收到的系统提示词全文；其能力面由架构固定，提示词恒定。')
                  : t('这位成员**新对话**将收到的系统提示词全文（当前配置拼出；api 与工作流面按团队分工拼装）。进行中的对话用首轮固化的那份，不受影响。')
              }
            />
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-soft">
              {isTutor && (
                <>
                  <span>
                    {t('人格')}: <span className="text-ink-strong">{personaOf(agentSettings.persona).label}</span>
                  </span>
                  <span>
                    {t('文档格式')}: <span className="text-ink-strong">{docFormatOf(agentSettings.docFormat).label}</span>
                  </span>
                </>
              )}
              <span>
                {t('追加提示词')}:{' '}
                <span className="text-ink-strong">{extra ? t('已启用') : t('未启用')}</span>
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-line/70 bg-paper-deep/40">
              <div className="flex items-center justify-between border-b border-line/60 px-3 py-1.5">
                <span className="text-[11px] text-ink-faint">
                  {t('{0} 字', systemPrompt.length)}
                </span>
                <button
                  type="button"
                  onClick={copyPrompt}
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-ink-soft transition hover:bg-line/50 hover:text-ink"
                >
                  {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  <span>{copied ? t('已复制') : t('复制全文')}</span>
                </button>
              </div>
              <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-soft">
                {systemPrompt}
              </pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

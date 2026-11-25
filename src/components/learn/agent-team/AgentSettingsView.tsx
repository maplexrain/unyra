/**
 * 智能体的**独立设置页**：角色阵容中央工作区在「设置态」下替换对话流的那一块
 * （AgentSlot 的 settingsAgent 状态控制，见 workspace/AgentSlot）。
 *
 * 管的是「这位 role 自己」：名字与头像、跑在哪家提供商-模型上、思考档位、
 * execute 开放哪些 api 组、能触发哪些工作流，以及只读查看它实际会收到的系统提示词。
 * 每个字段都遵循 agent/agentProfile 的缺省语义：没改过 = 跟随默认 / 全局，
 * 改过才落盘；「恢复默认」整条清除覆盖。
 *
 * 与全局的「超级导师设置」（AgentSettingsPanel，管人格 / 技能 / MCP / 权限这些
 * 导师层面的机制）是两回事：这里是按 role 逐个配的「它自己是谁、用什么跑」。
 */

import { useSyncExternalStore } from 'react'
import { ArrowLeft, GraduationCap, MessageSquare, RotateCcw } from 'lucide-react'
import { REASONING_LABEL, type ReasoningEffort } from '../../../ai/types'
import EffortSlider from '../../agent/EffortSlider'
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
import {
  AGENT_AVATARS,
  AGENT_WORKFLOW_PLANES,
  DEFAULT_AGENT_NAME,
  FIXED_API_PLANE,
  WORK_FIXED_PLANE,
  variableWorkGroupsOf,
  variableWorkTopLevelOf,
  type AgentProfile,
  type AgentProfileId,
  type AgentVoice,
} from '../../../agent/agentProfile'
import { DEFAULT_PROMPT_FILE_SETTINGS, type PromptFileSettings } from '../../../agent/promptFiles'
import { t, useLocale } from '../../../i18n'
import { builtinWorkflowRows, type WorkflowRow } from '../../../learn/workflows'
import { AgentAvatarGlyph } from './AgentAvatarGlyph'
import { PromptFilesView } from './PromptFilesView'
import type { PromptFileItem } from '../../../learn/ai/promptFiles'
import type { AgentTeamMode } from './conversationList'

export interface AgentSettingsViewProps {
  agentId: AgentTeamMode
  /** 这位 role 当前的 profile（AgentSlot 从 agentSettings 现取） */
  profile: AgentProfile
  /** 合并一段覆盖（undefined 字段 = 清除该覆盖）；落盘与广播由调用方完成 */
  onChange: (patch: Partial<AgentProfile>) => void
  /** 整条恢复默认 */
  onReset: () => void
  /** 关闭设置页，回到对话流 */
  onClose: () => void
  /** 工作流清单（导师 = 当前目标作用域的内置 + 全局 + 目标级） */
  flowRows: WorkflowRow[]
  /** 提示词文件库与顺序（全局设置，不在 profile 覆盖里） */
  promptFiles?: PromptFileSettings
  onPromptFilesChange?: (next: PromptFileSettings) => void
  /** 点开一份提示词文件：内置走只读提示词页签，外置走本地 md 页签 */
  onOpenPromptFile?: (file: PromptFileItem) => void
}

/** 分节标题：只留标题，不渲染说明性小字 */
function SectionHead({ title }: { title: string; hint?: string }) {
  return (
    <div className="mb-2.5">
      <h3 className="text-[13px] font-semibold text-ink-strong">{title}</h3>
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

interface ApiRow {
  key: string
  label: string
  code: string
}

/** execute api 的只读行清单（固定组 / 非固定组共用同一行样式，靠徽标区分） */
function ApiRowList(props: { rows: ApiRow[]; badge: string; tone: 'fixed' | 'variable' }) {
  const badgeClass =
    props.tone === 'fixed'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
  return (
    <ul className="flex flex-col divide-y divide-line/50 rounded-lg border border-line/70 bg-paper-deep/30">
      {props.rows.map((row) => (
        <li key={row.key} className="flex items-center gap-2 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">
            {row.label}
          </span>
          <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${badgeClass}`}>
            {props.badge}
          </span>
          <code className="shrink-0 text-[10px] text-ink-faint">{row.code}</code>
        </li>
      ))}
    </ul>
  )
}

export function AgentSettingsView({
  agentId,
  profile,
  onChange,
  onReset,
  onClose,
  flowRows,
  promptFiles = DEFAULT_PROMPT_FILE_SETTINGS,
  onPromptFilesChange = () => {},
  onOpenPromptFile,
}: AgentSettingsViewProps) {
  useLocale()
  const isTutor = agentId === 'tutor'
  const isFree = agentId === 'free'
  /** 承接 role（出卷师 / 设计师 / 调研员 / 维修员）：api 与工作流面都是架构分工固定的只读清单 */
  const isSpecialist = !isTutor && !isFree
  const ai = useSyncExternalStore(subscribeAiSettings, loadAiSettings)

  /* ---------- 身份 ---------- */
  const displayName = profile.name?.trim() || t(DEFAULT_AGENT_NAME[agentId])
  // 头像兜底：仅聊天落对话气泡、其余落导师帽（龟龟图片在 Glyph 里认 id 现画）
  const avatarFallback = isFree ? MessageSquare : GraduationCap

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

  /* ---------- execute api（role 只有固定编排面；领域能力在 work 设置节展示） ---------- */
  /**
   * role 层能力面由架构固定：help / compact + tmp / work / chat。
   * 领域组（node / exam / classroom / web …）全部下沉到 work，在下方「工作层（work）」只读展示。
   */
  const coreCatalog = SANDBOX_API_CATALOG.find((g) => g.key === 'core')
  const fixedRows: ApiRow[] = []
  const variableRows: ApiRow[] = []
  const coreItem = (name: string): ApiRow | undefined => {
    const item = coreCatalog?.items.find((i) => i.name === name)
    return item ? { key: 'core:' + name, label: item.summary, code: 'api.' + name } : undefined
  }
  for (const name of ['help', ...FIXED_API_PLANE.topLevel]) {
    const row = coreItem(name)
    if (row) fixedRows.push(row)
  }
  for (const key of FIXED_API_PLANE.groups) {
    const group = SANDBOX_API_CATALOG.find((g) => g.key === key)
    if (group) fixedRows.push({ key, label: t(group.label), code: 'api.' + key })
  }
  /* ---------- 工作流（导师可配白名单；承接 role = 分工固定的只读面） ---------- */
  const wfPlane = new Set(AGENT_WORKFLOW_PLANES[agentId as AgentVoice])
  // 内置行的锁死口径 = 本 role 的分工面：不在面上的内置规程它触发不了，干脆不展示
  //（免得进了「添加」下拉、加了又被通道口拒绝）
  const wfItems = flowRows
    .filter((r) => r.tier !== 'builtin' || wfPlane.has(r.id))
    .map((r) => ({
      key: r.id,
      label: r.name,
      tag: r.tier === 'builtin' ? '内置' : r.tier === 'global' ? '全局' : '目标级',
      builtin: r.tier === 'builtin',
    }))
  /** 承接 role 的固定工作流面（只有内置规程，没有登记条目） */
  const specialistWfItems = builtinWorkflowRows()
    .filter((r) => wfPlane.has(r.id))
    .map((r) => ({ key: r.id, label: r.name, tag: '内置' as const, builtin: true }))

  /* ---------- 系统提示词文件（只列项，不展开正文） ---------- */

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
        <AgentAvatarGlyph
          avatarId={profile.avatar}
          fallback={avatarFallback}
          size={14}
          imgSize={18}
          imgClassName="h-[18px] w-[18px] rounded-md"
        />
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
            <SectionHead title={t('身份')} hint={t('改的是角色阵容左栏与这里的显示；不影响对话内容。')} />
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
                    const on = (profile.avatar ?? '') === a.id
                    return (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={on}
                        title={t(a.label)}
                        onClick={() => onChange({ avatar: on ? undefined : a.id })}
                        className={
                          'flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border transition ' +
                          (on
                            ? 'border-seal/60 bg-seal/10 text-seal'
                            : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink')
                        }
                      >
                        <AgentAvatarGlyph
                          avatarId={a.id}
                          fallback={MessageSquare}
                          size={15}
                          imgSize={32}
                          imgClassName="h-8 w-8 rounded-lg"
                        />
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
            <div className="flex max-w-[340px] flex-col gap-2">
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-ink-soft">
                  {profile.effort === undefined
                    ? `${t('跟随全局')}（${t(REASONING_LABEL[globalEffort(ai)])}）`
                    : `${t('独立档位')}：${t(REASONING_LABEL[profile.effort])}`}
                </span>
                {profile.effort !== undefined && (
                  <button
                    type="button"
                    onClick={() => onChange({ effort: undefined })}
                    className="cursor-pointer text-[11px] text-seal hover:underline"
                  >
                    {t('恢复跟随全局')}
                  </button>
                )}
              </div>
              <EffortSlider
                value={(profile.effort ?? globalEffort(ai)) as ReasoningEffort}
                onChange={(next) => onChange({ effort: next })}
              />
            </div>
          </section>

          {/* ---------- execute 开放的 api（能力面固定：固定组 / 非固定组两份只读清单） ---------- */}
          <section data-api-section className="border-b border-line/60 py-4">
            <SectionHead
              title={t('execute 开放的 api')}
              hint={
                isFree
                  ? t('自由对话只有 work / chat / tmp / compact 固定面；联网、日程等领域能力全部在 work 层。')
                  : isTutor
                    ? t('导师的 role 面按架构固定、只读（不可增删）：只保留对学习者说话与编排 work 的固定基座；领域执行面全部在下方「工作层（work）」。')
                    : t('这位 role 的 api 面由架构分工固定、只读（不可增删）：role 只保留 work / chat / tmp / compact，领域执行能力在 work 层。')
              }
            />
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-[11px]">
                  <span className="font-semibold text-ink-strong">{t('固定组')}</span>
                  <span className="min-w-0 truncate text-ink-faint">
                    {isFree ? t('自由对话的固定执行基座') : t('六位 role 共用 · 架构固定')}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-ink-faint">
                    {t('{0} 项', fixedRows.length)}
                  </span>
                </div>
                <ApiRowList rows={fixedRows} badge={t('固定 · 恒开放')} tone="fixed" />
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-[11px]">
                  <span className="font-semibold text-ink-strong">{t('非固定组')}</span>
                  <span className="min-w-0 truncate text-ink-faint">
                    {isFree ? t('role 层不直接持有领域能力') : t('role 层不直接持有领域能力')}
                  </span>
                  {variableRows.length > 0 && (
                    <span className="ml-auto shrink-0 tabular-nums text-ink-faint">
                      {t('{0} 项', variableRows.length)}
                    </span>
                  )}
                </div>
                {variableRows.length > 0 ? (
                  <ApiRowList rows={variableRows} badge={t('专属 · 恒开放')} tone="variable" />
                ) : (
                  <p className="rounded-lg border border-line/70 bg-paper-deep/40 px-3 py-2 text-[11.5px] leading-relaxed text-ink-faint">
                    {isFree
                      ? t('无：role 层只保留固定编排面，领域能力全部在 work 层。')
                      : t('无：这位 role 只持有全员共用的固定基座。')}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ---------- 工作层（work，只读） ---------- */}
          <section data-work-layer className="border-b border-line/60 py-4">
            <SectionHead
              title={t('工作层（work）')}
              hint={t('work 没有人格、不共享 role 的对话上下文；它由 role 用 work.create / work.send 派出，执行完用 host.send 把交付交回 role。下面是从 role 能力面派生出的 work 面，只读。')}
            />
            <div className="rounded-lg border border-line/70 bg-paper-deep/30 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-soft">
                <span className="font-medium text-ink-strong">{t('固定')}</span>
                {['help', ...WORK_FIXED_PLANE.groups, ...WORK_FIXED_PLANE.topLevel].map((key) => (
                  <code key={key} className="rounded bg-line/60 px-1.5 py-px text-[10.5px] text-ink-faint">
                    api.{key}
                  </code>
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-soft">
                <span className="font-medium text-ink-strong">{t('按 role 派生')}</span>
                {[
                  ...variableWorkGroupsOf(agentId as AgentProfileId).map((g) => 'api.' + g + '.*'),
                  ...variableWorkTopLevelOf(agentId as AgentProfileId).map((n) => 'api.' + n),
                ].map((key) => (
                  <code key={key} className="rounded bg-line/50 px-1.5 py-px text-[10.5px] text-ink-faint">
                    {key}
                  </code>
                ))}
                {variableWorkGroupsOf(agentId as AgentProfileId).length === 0 &&
                variableWorkTopLevelOf(agentId as AgentProfileId).length === 0 ? (
                  <span className="text-[11px] text-ink-faint">{t('这位 role 的 work 只有固定面。')}</span>
                ) : null}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
                {t('work 的系统提示词由 role 自动生成（内容类 role 带共用排版内核），不在设置里改；它不是独立人格，也没有用户对话历史。')}
              </p>
            </div>
          </section>

          {/* ---------- 工作层的工作流（由 work 执行，role 只路由） ---------- */}
          <section className="border-b border-line/60 py-4">
            <SectionHead
              title={t('工作层的工作流')}
              hint={
                isFree
                  ? t('自由对话的 work 没有工作流通道（wf.*），此设置不生效；需要开讲、出卷这类流程请找导师。')
                  : isTutor
                    ? t('工作流由导师的 work 执行，role 只负责路由与汇报。内置规程按架构分工恒开放、只读；白名单只管登记的全局 / 目标级工作流——work 的 wf.list 只列出的，越权触发当场拒绝。')
                    : t('工作流由这位 role 派出的 work 执行，role 本身不触发；内置规程由架构分工固定、只读（不可增删）。登记的全局 / 目标级工作流只有导师的 work 能触发。')
              }
            />
            {isTutor ? (
              <AllowListEditor
                items={wfItems}
                selected={profile.workflows}
                onChange={(list) => onChange({ workflows: list })}
                addLabel={t('添加工作流')}
                addHook="wf"
                emptyNote="未添加任何项：登记的工作流全部可用（本 role 的内置规程面恒开放）。"
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

          {/* ---------- 系统提示词文件（只列项，不展开正文） ---------- */}
          <section className="py-4">
            <SectionHead title={t('系统提示词')} />
            <PromptFilesView
              agentId={agentId}
              settings={promptFiles}
              onChange={onPromptFilesChange}
              onOpenFile={onOpenPromptFile}
            />
          </section>
        </div>
      </div>
    </div>
  )
}

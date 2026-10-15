import { useState } from 'react'
import TabButton from './TabButton'
import {
  CheckCircle2,
  Cpu,
  GraduationCap,
  Sparkles,
  Terminal,
  Workflow,
  Wrench,
} from 'lucide-react'
import {
  COMPACT_THRESHOLD_MAX,
  COMPACT_THRESHOLD_MIN,
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
} from '../agent/settings'
import { isDevUnlocked } from '../lib/devMode'
import { REASONING_EFFORTS, REASONING_LABEL } from '../ai/types'
import { BUILTIN_EFFORT, type WorkflowEffortSetting, type WorkflowRow, type WorkflowTier } from '../learn/workflows'
import { getActiveSkills } from '../agent/skill/registry'
import { SkillsTab } from './agent-settings/SkillsTab'
import { McpTab } from './agent-settings/McpTab'
import { ToolsTab } from './agent-settings/ToolsTab'
import ConfirmDialog from './ConfirmDialog'
import DevUnlock from './DevUnlock'
import { pane } from './Pane'
import Switch from './Switch'
import { t } from '../i18n'

/**
 * 超级导师设置。文档区的一枚页签，数据与全局设置分开（见 agent/settings）：
 * 全局设置管「模型与 API Key」，这里管「这个 Agent 自身怎么跑与具备哪些能力」。
 *
 * 分页：
 * - 「对话」：上下文压缩阈值与自动折叠策略。
 * - 「技能」：专业思维模型、解题框架与认知规范 (Skills)。
 * - 「MCP 服务」：Model Context Protocol 开放工具与远端/本地上下文服务。
 * - 「工具」：沙箱与原生 API (文件系统白名单、进程监控、上下文健康度)。
 * - 「工作流」：导师代跑的任务模板（出卷、回忆、超级实验室等）。
 * - 「开发者」：三击标题解锁，底层调试口令与诊断开关。
 */

interface Props {
  settings: AgentSettings
  hasKey: boolean
  /** 「提供商 · 模型」，说明这些设置作用在谁身上 */
  model: string
  onChange: (next: AgentSettings) => void
  /** 打开上下文比对调试器（悬浮窗由工作区渲染，见 LearnWorkspace） */
  onOpenContextDebugger: () => void
  /** 工作流列表（内置 + 全局 + 当前目标，见 learn/workflows）；不传就整个分页不显示 */
  flowRows?: WorkflowRow[]
  /** 从列表直接跑一条（占位参数由工作区按当前节点补齐） */
  onRunWorkflow?: (row: WorkflowRow) => void
  /** 删除一条登记的工作流（内置的到不了这里） */
  onRemoveWorkflow?: (row: WorkflowRow) => void
  /** 改一条工作流的思考档位（三态；内置与登记通吃，键 = id 记在全局 efforts 表） */
  onWorkflowEffort?: (row: WorkflowRow, effort: WorkflowEffortSetting) => void
}

type TabKey = 'chat' | 'skills' | 'mcp' | 'tools' | 'flow' | 'dev'

const TAB_KEY = 'moji:agent-settings:tab'

const TABS: Array<{ key: TabKey; label: string; icon: typeof Sparkles }> = [
  { key: 'chat', label: '对话与压缩', icon: Sparkles },
  { key: 'skills', label: '专业技能', icon: GraduationCap },
  { key: 'mcp', label: 'MCP 服务', icon: Cpu },
  { key: 'tools', label: '工具与上下文', icon: Wrench },
  { key: 'flow', label: '工作流', icon: Workflow },
]
const DEV_TAB: { key: TabKey; label: string; icon: typeof Sparkles } = {
  key: 'dev',
  label: '开发者模式',
  icon: Terminal,
}

const savedTab = (): TabKey => {
  try {
    const v = localStorage.getItem(TAB_KEY) as TabKey | null
    if (v === 'dev') return isDevUnlocked() ? 'dev' : 'chat'
    if (v === 'chat' || v === 'skills' || v === 'mcp' || v === 'tools' || v === 'flow') return v
  } catch {
    // localStorage 不可用时回落到第一页
  }
  return 'chat'
}

const rememberTab = (key: TabKey): void => {
  try {
    localStorage.setItem(TAB_KEY, key)
  } catch {
    // ignore
  }
}

export default function AgentSettingsPanel({
  settings,
  hasKey,
  model,
  onChange,
  onOpenContextDebugger,
  flowRows,
  onRunWorkflow,
  onRemoveWorkflow,
  onWorkflowEffort,
}: Props) {
  /** 三击「超级导师设置」标题：开发者分页的隐藏入口 */
  const [devEntry, setDevEntry] = useState(false)
  const devVisible = devEntry || isDevUnlocked()
  const [tab, setTab] = useState<TabKey>(() => (devVisible ? savedTab() : 'chat'))

  const baseTabs = flowRows ? TABS : TABS.filter((tb) => tb.key !== 'flow')
  const tabs = devVisible ? [...baseTabs, DEV_TAB] : baseTabs

  const select = (key: TabKey): void => {
    setTab(key)
    rememberTab(key)
  }

  // 统计各模块的活跃徽标数
  const activeSkillsCount = getActiveSkills(settings.skills).length
  const activeMcpCount = (settings.mcp?.servers || []).filter((s) => s.enabled).length

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 bg-paper">
      {/* 左侧导航栏 */}
      <nav className="flex w-[196px] shrink-0 flex-col gap-1.5 border-r border-line bg-paper-deep/80 px-3 py-4 select-none">
        {/* 标题与品牌区：三击进入开发者模式 */}
        <div
          className="group flex cursor-pointer items-center gap-2.5 rounded-xl px-2 pb-3 pt-1 transition hover:bg-paper/50"
          title={t('连续三击标题可解锁开发者模式')}
          onClick={(e) => {
            if (e.detail >= 3) setDevEntry(true)
          }}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-seal/20 to-seal/5 text-seal border border-seal/20 shadow-2xs">
            <Sparkles size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[13.5px] font-bold tracking-tight text-ink-strong">{t('超级导师')}</h1>
            <p className="text-[10px] text-ink-faint truncate">{t('全局 Agent 配置')}</p>
          </div>
        </div>

        {/* Tab 导航项 */}
        <div className="flex flex-col gap-1 pt-1">
          {tabs.map((tb) => {
            let badgeText: string | number | undefined
            if (tb.key === 'skills' && activeSkillsCount > 0) badgeText = activeSkillsCount
            else if (tb.key === 'mcp' && activeMcpCount > 0) badgeText = activeMcpCount
            else if (tb.key === 'flow' && flowRows) badgeText = flowRows.length

            return (
              <TabButton
                key={tb.key}
                icon={tb.icon}
                label={t(tb.label)}
                active={tab === tb.key}
                onClick={() => select(tb.key)}
                badge={
                  badgeText !== undefined ? (
                    <span
                      className={`rounded-full px-1.5 py-px text-[10px] font-medium ${
                        tab === tb.key
                          ? 'bg-seal/15 text-seal-deep font-semibold'
                          : 'bg-line/60 text-ink-faint'
                      }`}
                    >
                      {badgeText}
                    </span>
                  ) : undefined
                }
              />
            )
          })}
        </div>

        {/* 底部当前生效模型微卡片 */}
        <div className="mt-auto border-t border-line/60 pt-3">
          <div className="rounded-xl border border-line bg-card/60 p-2.5 shadow-2xs">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink-faint">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>{t('当前生效模型')}</span>
            </div>
            <div className="mt-1 truncate text-[11.5px] font-semibold text-ink-strong" title={model || t('尚未选择模型')}>
              {model || t('未配置模型')}
            </div>
            <p className="mt-0.5 text-[9.5px] text-ink-faint line-clamp-1">
              {hasKey ? t('API Key 已就绪') : t('需在全局设置配置 Key')}
            </p>
          </div>
        </div>
      </nav>

      {/* 右侧内容展示区 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 头部标题与自动保存状态 */}
        <header className="flex shrink-0 items-center justify-between border-b border-line px-6 py-3.5 bg-paper">
          <div>
            <h2 className="text-[15px] font-bold text-ink-strong">
              {tab === 'dev'
                ? t('开发者模式')
                : tab === 'flow'
                  ? t('工作流模板')
                  : tab === 'skills'
                    ? t('专业技能扩展 (Skills)')
                    : tab === 'mcp'
                      ? t('Model Context Protocol (MCP)')
                      : tab === 'tools'
                        ? t('工具与上下文管理')
                        : t('对话与上下文设置')}
            </h2>
            <p className="text-[11.5px] text-ink-faint mt-0.5">
              {tab === 'dev'
                ? t('底层系统与调试工具，普通学习过程无需开启')
                : tab === 'flow'
                  ? t('由导师代跑的任务模板；触发时指令以 user 消息进入上下文')
                  : tab === 'skills'
                    ? t('为导师装配特定的认知框架、启发策略与解题规范')
                    : tab === 'mcp'
                      ? t('连接开放协议服务，赋予导师操作真实世界系统与网络的能力')
                      : tab === 'tools'
                        ? t('原生系统文件与进程权限放行、上下文健康度及沙箱能力目录')
                        : t('只影响对话区里的超级导师自身，与全局 AI 设置保持独立')}
            </p>
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-line bg-card/60 px-2.5 py-1 text-[11px] text-ink-faint shadow-2xs">
            <CheckCircle2 size={12} className="text-emerald-500" />
            <span>{t('随改随存 · 即时生效')}</span>
          </div>
        </header>

        {/* 内容视图路由 */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === 'chat' ? (
            <ChatTab settings={settings} hasKey={hasKey} model={model} onChange={onChange} />
          ) : tab === 'skills' ? (
            <SkillsTab
              settings={settings.skills}
              onChange={(nextSkills) => onChange({ ...settings, skills: nextSkills })}
            />
          ) : tab === 'mcp' ? (
            <McpTab
              settings={settings.mcp}
              onChange={(nextMcp) => onChange({ ...settings, mcp: nextMcp })}
            />
          ) : tab === 'tools' ? (
            <ToolsTab
              settings={settings}
              onChange={onChange}
              onOpenContextDebugger={onOpenContextDebugger}
            />
          ) : tab === 'flow' && flowRows && onRunWorkflow && onRemoveWorkflow && onWorkflowEffort ? (
            <FlowTab rows={flowRows} onRun={onRunWorkflow} onRemove={onRemoveWorkflow} onEffort={onWorkflowEffort} />
          ) : (
            <DevTab onSelectTab={select} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- 对话分页 ---------- */

function ChatTab({
  settings,
  hasKey,
  model,
  onChange,
}: {
  settings: AgentSettings
  hasKey: boolean
  model: string
  onChange: (next: AgentSettings) => void
}) {
  const c = settings.compact
  const patch = (next: Partial<AgentSettings['compact']>) =>
    onChange({ ...settings, compact: { ...c, ...next } })

  return (
    <div className={pane(4)}>
      {/* 当前模型状态卡片 */}
      <section className="rounded-xl border border-line bg-card p-4 shadow-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-ink-soft">{t('当前服务模型')}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-strong">
            {model || t('尚未配置模型')}
          </span>
        </div>
        {!hasKey && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-warn-deep bg-warn/10 rounded-lg p-2.5 border border-warn/20">
            {t('当前提供商尚未填写 API Key：压缩上下文需要消耗一次模型生成摘要，填好后方可使用。模型可在顶栏全局设置中修改。')}
          </p>
        )}
      </section>

      {/* 自动压缩开关 */}
      <Switch
        on={c.auto}
        onChange={(auto) => patch({ auto })}
        label={t('上下文快满时自动压缩')}
        hint={t('当单轮对话累计上下文达到下方阈值时，自动折叠前期会话为交接摘要，避免因超长上下文导致调用失败')}
      />

      {/* 阈值调节滑块 */}
      <section className={'rounded-xl border border-line bg-card p-4 shadow-sm transition ' + (c.auto ? '' : 'opacity-60')}>
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-ink-strong">{t('自动压缩阈值')}</span>
          <span className="text-[11.5px] text-ink-faint">
            {t('上下文占用到 {0}% 时自动触发压缩', Math.round(c.threshold * 100))}
          </span>
          <span className="ml-auto text-[15px] font-bold text-seal-deep tabular-nums">
            {Math.round(c.threshold * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={Math.round(COMPACT_THRESHOLD_MIN * 100)}
          max={Math.round(COMPACT_THRESHOLD_MAX * 100)}
          step={5}
          value={Math.round(c.threshold * 100)}
          disabled={!c.auto}
          onChange={(e) => patch({ threshold: Number(e.target.value) / 100 })}
          className="mt-3.5 w-full accent-[var(--color-seal)] cursor-pointer"
        />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {t('窗口占用基于服务端实际返回用量精确计算。保留余量至关重要：在多跳循环中后续各跳的输入随工具结果逐步增大，过于贴近上限极易报错。')}
        </p>
      </section>

      {/* 机制说明 */}
      <section className="rounded-xl border border-line bg-sunken/60 p-3.5">
        <p className="text-[11.5px] leading-relaxed text-ink-soft">
          {t('压缩后，历史旧消息将不再进入模型上下文，但界面上会原样完整保留展示（绝不删减任何用户历史）。 对话流中的虚线为分界线，点击「查看摘要」可随时审阅导师凝练的记忆。')}
        </p>
      </section>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() =>
            onChange({
              ...DEFAULT_AGENT_SETTINGS,
              dev: settings.dev,
              persona: settings.persona,
              docFormat: settings.docFormat,
              skills: settings.skills,
              mcp: settings.mcp,
            })
          }
          className="rounded-xl border border-line bg-card px-3 py-1.5 text-[11.5px] text-ink-soft shadow-2xs transition hover:bg-line/60 hover:text-ink"
        >
          {t('恢复推荐设置 (自动 · 70%)')}
        </button>
      </div>
    </div>
  )
}

/* ---------- 开发者分页 ---------- */

function DevTab({ onSelectTab }: { onSelectTab?: (tab: TabKey) => void }) {
  const [unlocked, setUnlocked] = useState(isDevUnlocked)
  if (!unlocked) {
    return (
      <div className={pane(4)}>
        <section className="rounded-xl border border-line bg-card p-5">
          <h4 className="text-[13px] font-semibold text-ink-strong mb-1">{t('开发者口令验证')}</h4>
          <p className="mb-3 text-[11.5px] leading-relaxed text-ink-faint">
            {t('这一页平时不显示。请输入口令解锁（与全局设置开发者分页共享解锁状态）。')}
          </p>
          <DevUnlock
            inputClass="min-w-0 rounded-lg border border-line bg-card px-3 py-2 text-[12px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/60 focus:ring-2 focus:ring-seal/15 w-[240px] font-mono"
            onUnlocked={() => setUnlocked(true)}
          />
        </section>
      </div>
    )
  }
  return (
    <div className={pane(4)}>
      <section className="rounded-xl border border-line bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Terminal size={16} className="text-seal" />
          <h4 className="text-[13.5px] font-semibold text-ink-strong">{t('开发者模式已激活')}</h4>
        </div>
        <p className="text-[11.5px] leading-relaxed text-ink-faint">
          {t('超级导师的上下文管理、沙箱工具目录、进程监控与安全权限放行已迁至独立的「工具与上下文」分页，提供更加现代化的全景交互与健康度监控。')}
        </p>
        {onSelectTab && (
          <div className="mt-3.5">
            <button
              type="button"
              onClick={() => onSelectTab('tools')}
              className="flex items-center gap-1.5 rounded-xl bg-seal px-3.5 py-1.5 text-[12px] font-medium text-white shadow-2xs transition hover:bg-seal-deep"
            >
              <Wrench size={13} />
              <span>{t('前往「工具与上下文」分页')}</span>
            </button>
          </div>
        )}
      </section>

      <div className="rounded-xl border border-line bg-card/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        {t('开发者口令已验证通过，底层调试接口与全局设置共享解锁状态。')}
      </div>
    </div>
  )
}

/* ---------- 工作流分页 ---------- */

const FLOW_TIERS: Array<{ tier: WorkflowTier; label: string; hint: string; badge: string }> = [
  { tier: 'builtin', label: '内置', hint: '随应用提供，触发入口在对话与文档区里，不可删除', badge: 'bg-line/60 text-ink-soft' },
  { tier: 'global', label: '全局', hint: '每个学习目标的导师都能用', badge: 'bg-seal/10 text-seal-deep' },
  { tier: 'goal', label: '目标级', hint: '只在当前学习目标里可用', badge: 'bg-ink/10 text-ink-soft' },
]

function FlowTab({
  rows,
  onRun,
  onRemove,
  onEffort,
}: {
  rows: WorkflowRow[]
  onRun: (row: WorkflowRow) => void
  onRemove: (row: WorkflowRow) => void
  onEffort: (row: WorkflowRow, effort: WorkflowEffortSetting) => void
}) {
  const [pending, setPending] = useState<WorkflowRow | null>(null)
  return (
    <div className={pane(4)}>
      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        {t('工作流是「不由一条消息直接驱动」的任务模板：开讲、回忆、出卷、超级实验室…… 它们不进系统提示词——被触发时，指令才以一条 user 消息整段进入上下文（对话里是一条分界条）。 想登记新的工作流，在对话里让超级导师用')}
        <code className="mx-1 rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[10.5px] text-seal-deep">api.wf.create</code>
        {t('完成，这里会立刻看到。')}
      </p>

      {FLOW_TIERS.map(({ tier, label, hint, badge }) => {
        const items = rows.filter((r) => r.tier === tier)
        return (
          <section key={tier} className="shrink-0 overflow-hidden rounded-xl border border-line bg-card shadow-sm">
            <div className="border-b border-line bg-paper-deep/60 px-3.5 py-2.5">
              <span className="text-[12.5px] font-semibold text-ink-strong">{t(label)}</span>
              <span className="ml-2 text-[10.5px] text-ink-faint">{t('{0} 条 · {1}', items.length, t(hint))}</span>
            </div>
            {items.length ? (
              <ul className="divide-y divide-line/60">
                {items.map((row) => (
                  <li key={row.id} className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-paper/40 transition">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12.5px] font-semibold text-ink-strong">{t(row.name)}</span>
                        <span className={'rounded px-1.5 py-px text-[10px] ' + badge}>{t(label)}</span>
                        {row.params && row.params.length > 0 && (
                          <span className="rounded bg-line/60 px-1.5 py-px text-[10px] text-ink-soft">
                            {t('触发要参数：{0}', row.params.join(' / '))}
                          </span>
                        )}
                      </div>
                      {row.description && (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">{t(row.description)}</p>
                      )}
                      <p className="mt-0.5 text-[10.5px] text-ink-faint">{t('指令 {0} 字', row.instruction.length)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                      <label
                        className="flex items-center gap-1 text-[10.5px] text-ink-faint"
                        title={t('思考档位：工作流轮的档位独立于聊天滑条。默认 = 内置推荐档；跟随聊天 = 用滑条那档')}
                      >
                        {t('思考')}
                        <select
                          value={row.effort ?? (row.tier === 'builtin' ? 'default' : 'chat')}
                          onChange={(e) => onEffort(row, e.target.value as WorkflowEffortSetting)}
                          className="rounded-lg border border-line bg-card px-2 py-1 text-[11.5px] text-ink-soft outline-none transition focus:border-seal/60"
                        >
                          {row.tier === 'builtin' && (
                            <option value="default">{t('默认（{0}）', REASONING_LABEL[BUILTIN_EFFORT[row.id] ?? 'high'])}</option>
                          )}
                          <option value="chat">{t('跟随聊天')}</option>
                          {REASONING_EFFORTS.map((e) => (
                            <option key={e} value={e}>
                              {REASONING_LABEL[e]}
                            </option>
                          ))}
                        </select>
                      </label>
                      {row.runnable && (
                        <button
                          type="button"
                          onClick={() => onRun(row)}
                          className="rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] text-ink-soft transition hover:border-seal/50 hover:text-seal"
                        >
                          {t('运行')}
                        </button>
                      )}
                      {tier !== 'builtin' && (
                        <button
                          type="button"
                          onClick={() => setPending(row)}
                          className="rounded-lg px-2 py-1 text-[11.5px] text-ink-faint transition hover:bg-line/60 hover:text-seal-deep"
                        >
                          {t('删除')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3.5 py-3 text-[11px] text-ink-faint">{t('（还没有登记的工作流）')}</p>
            )}
          </section>
        )
      })}

      {pending && (
        <ConfirmDialog
          title={t('删除工作流「{0}」？', pending.name)}
          message={t('删除后这个触发入口就没了，指令文本也无法恢复；需要时可以让超级导师重新登记一份。')}
          confirmLabel={t('删除')}
          onConfirm={() => {
            const row = pending
            setPending(null)
            onRemove(row)
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}

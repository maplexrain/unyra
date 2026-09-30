import { useState } from 'react'
import { useEscapeKey } from '../lib/useEscape'
import TabButton from './TabButton'
import { Bug, Sparkles, Terminal, Workflow, X } from 'lucide-react'
import {
  COMPACT_THRESHOLD_MAX,
  COMPACT_THRESHOLD_MIN,
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
  type AgentDevSettings,
} from '../agent/settings'
import { SANDBOX_API_CATALOG } from '../agent/apiCatalog'
import { clearRecords as clearContextRecords } from '../agent/contextFilter'
import { isDevUnlocked } from '../lib/devMode'
import { REASONING_EFFORTS, REASONING_LABEL } from '../ai/types'
import { BUILTIN_EFFORT, type WorkflowEffortSetting, type WorkflowRow, type WorkflowTier } from '../learn/workflows'
import ConfirmDialog from './ConfirmDialog'
import DevUnlock from './DevUnlock'
import ModalScrim from './ModalScrim'
import { pane } from './Pane'
import Switch from './Switch'
import { t } from '../i18n'

/**
 * 超级导师设置。与全局设置一样是**带分页的窗口**，但数据是另一份（见 agent/settings）：
 * 全局设置回答「用哪家的哪个模型、Key 是什么」，这里回答「这个 Agent 自己怎么跑」。
 *
 * 分页：
 * - 「对话」：上下文压缩（什么时候压、压到什么程度）。
 * - 「开发者」：平时不显示——三击标题才出现，口令解锁后记住（与全局设置共用同一个
 *   解锁凭据，见 lib/devMode）。里面有上下文比对调试器的开关与入口、execute 沙箱
 *   的 api 目录（api 上下文管理）。
 *
 * 改动当场生效（没有「保存」键）：这里每一项都是滑块或开关，用户松手那一刻意思
 * 已经确定了。选中的分页记在 localStorage 里，下次打开还停在那一页。
 */

interface Props {
  settings: AgentSettings
  hasKey: boolean
  /** 「提供商 · 模型」，说明这些设置作用在谁身上 */
  model: string
  onChange: (next: AgentSettings) => void
  onClose: () => void
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

type TabKey = 'chat' | 'flow' | 'dev'

const TAB_KEY = 'moji:agent-settings:tab'

const TABS: Array<{ key: TabKey; label: string; icon: typeof Sparkles }> = [
  { key: 'chat', label: '对话', icon: Sparkles },
  { key: 'flow', label: '工作流', icon: Workflow },
]
const DEV_TAB: { key: TabKey; label: string; icon: typeof Sparkles } = { key: 'dev', label: '开发者', icon: Terminal }

const savedTab = (): TabKey => {
  try {
    const v = localStorage.getItem(TAB_KEY)
    // 开发者分页只有解锁过才允许作为「上次的选择」回来
    if (v === 'dev') return isDevUnlocked() ? 'dev' : 'chat'
    if (v === 'chat' || v === 'flow') return v
  } catch {
    // localStorage 不可用：回落到第一页
  }
  return 'chat'
}

const rememberTab = (key: TabKey): void => {
  try {
    localStorage.setItem(TAB_KEY, key)
  } catch {
    // 存不下就算了：分页选择本来就是个「记得最好」的东西
  }
}

export default function AgentSettingsModal({
  settings,
  hasKey,
  model,
  onChange,
  onClose,
  onOpenContextDebugger,
  flowRows,
  onRunWorkflow,
  onRemoveWorkflow,
  onWorkflowEffort,
}: Props) {
  /** 三击「超级导师设置」标题：开发者分页的隐藏入口（与全局设置同一套手势） */
  const [devEntry, setDevEntry] = useState(false)
  const devVisible = devEntry || isDevUnlocked()
  const [tab, setTab] = useState<TabKey>(() => (devVisible ? savedTab() : 'chat'))
  // 工作流分页需要工作区把列表递进来；没递（理论上不会）就整页藏掉，免得开出一个空页
  const baseTabs = flowRows ? TABS : TABS.filter((tb) => tb.key !== 'flow')
  const tabs = devVisible ? [...baseTabs, DEV_TAB] : baseTabs

  const select = (key: TabKey): void => {
    setTab(key)
    rememberTab(key)
  }

  useEscapeKey(onClose)

  const patchDev = (patch: Partial<AgentDevSettings>) => {
    const next = { ...settings, dev: { ...settings.dev, ...patch } }
    onChange(next)
    // 关掉调试器就顺手清掉已记录的快照：开着才有记录的意义，留着只会让人误读
    if (patch.contextDebugger === false) clearContextRecords()
  }

  return (
    <ModalScrim z="z-[60]" onClose={onClose}>
      <div
        role="dialog"
        aria-label={t('超级导师设置')}
        className="moji-dialog-in flex h-[min(680px,90vh)] w-full max-w-3xl overflow-hidden rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.3)]"
      >
        <nav className="flex w-[168px] shrink-0 flex-col gap-1 border-r border-line bg-paper-deep px-3 py-4">
          {/* 三击标题 = 开发者分页的入口；e.detail 是连击数 */}
          <div
            className="flex items-center gap-2 px-2 pb-3 text-[15px] font-semibold text-ink-strong"
            onClick={(e) => {
              if (e.detail >= 3) setDevEntry(true)
            }}
          >
            <Sparkles size={15} className="shrink-0 text-seal" />
            {t('超级导师')}
          </div>
          {tabs.map((tb) => (
            <TabButton
              key={tb.key}
              icon={tb.icon}
              label={t(tb.label)}
              active={tab === tb.key}
              onClick={() => select(tb.key)}
            />
          ))}
        </nav>

        {/* min-h-0：这一列自己是 flex 项，不带它内容会把列撑破、内层 overflow-y-auto 永远不滚 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
            <h2 className="text-[15px] font-semibold text-ink-strong">
              {tab === 'dev' ? t('开发者') : tab === 'flow' ? t('工作流') : t('超级导师设置')}
            </h2>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-faint">
              {tab === 'dev'
                ? t('调试工具，全部默认关闭')
                : tab === 'flow'
                  ? t('导师可以代跑的任务模板；触发时指令以 user 消息进上下文')
                  : t('只影响对话区里的超级导师，与全局设置分开')}
            </span>
            <button
              type="button"
              title={t('关闭')}
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
            >
              <X size={15} />
            </button>
          </header>

          {tab === 'chat' ? (
            <ChatTab settings={settings} hasKey={hasKey} model={model} onChange={onChange} />
          ) : tab === 'flow' && flowRows && onRunWorkflow && onRemoveWorkflow && onWorkflowEffort ? (
            <FlowTab rows={flowRows} onRun={onRunWorkflow} onRemove={onRemoveWorkflow} onEffort={onWorkflowEffort} />
          ) : (
            <DevTab settings={settings} onPatchDev={patchDev} onOpenContextDebugger={onOpenContextDebugger} />
          )}
        </div>
      </div>
    </ModalScrim>
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
    <div className={pane(3)}>
      <section className="rounded-lg border border-line bg-card px-3.5 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[11.5px] text-ink-soft">{t('当前模型')}</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-strong">{model || t('还没选模型')}</span>
        </div>
        {!hasKey && (
          <p className="mt-1 text-[11px] leading-relaxed text-warn-deep">
            {t('这个提供商还没有填 API Key：压缩上下文要用一次模型，填好之后才能用。 模型本身在顶栏的全局设置里换。')}
          </p>
        )}
      </section>

      <Switch
        on={c.auto}
        onChange={(auto) => patch({ auto })}
        label={t('上下文快满时自动压缩')}
        hint={t('到达下面的阈值时，让导师把前面的对话折成一份交接摘要（旧消息随即失活），不必等用户动手')}
      />

      <section className={'rounded-lg border border-line bg-card px-3.5 py-3 ' + (c.auto ? '' : 'opacity-60')}>
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] text-ink-strong">{t('自动压缩阈值')}</span>
          <span className="text-[11px] text-ink-faint">{t('上下文占用到 {0}% 时压一次', Math.round(c.threshold * 100))}</span>
          <span className="ml-auto text-[12.5px] font-medium text-seal-deep">{Math.round(c.threshold * 100)}%</span>
        </div>
        <input
          type="range"
          min={Math.round(COMPACT_THRESHOLD_MIN * 100)}
          max={Math.round(COMPACT_THRESHOLD_MAX * 100)}
          step={5}
          value={Math.round(c.threshold * 100)}
          disabled={!c.auto}
          onChange={(e) => patch({ threshold: Number(e.target.value) / 100 })}
          className="mt-2.5 w-full accent-[var(--color-seal)]"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          {t('窗口占用由服务端上一轮报回来的用量算，不是估算。留三成余量是有意的： 一轮里模型要来回好几跳，每一跳的输入都比上一跳大，压到只剩一点余量时最后一跳容易顶着窗口报错。 压缩本身是一轮工作流（导师自己写摘要，见「更多 → 压缩上下文」）。')}
        </p>
      </section>

      <section className="rounded-lg border border-line bg-sunken px-3.5 py-2.5">
        <p className="text-[11.5px] leading-relaxed text-ink-soft">
          {t('压缩之后，被压掉的那些消息**不再进入上下文，只在界面上显示**（原来的内容一条都不会删）—— 对话区里那条虚线就是分界线，点「看摘要」能核对导师到底记住了什么。 想立刻压一次，用输入框左下角「更多 → 压缩上下文」。')}
        </p>
      </section>

      <div className="flex items-center gap-2">
        <button
          type="button"
          // 只重置这一页管的东西（压缩）：人格是另一码事，不该被这颗按钮顺手改掉
          onClick={() =>
            onChange({ ...DEFAULT_AGENT_SETTINGS, dev: settings.dev, persona: settings.persona })
          }
          className="rounded-lg px-3 py-1.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
        >
          {t('恢复默认（自动 · 70% · 保留 8 条）')}
        </button>
        <span className="ml-auto text-[11px] text-ink-faint">{hasKey ? t('改动立即生效') : t('未配置 API Key')}</span>
      </div>
    </div>
  )
}

/* ---------- 开发者分页 ---------- */

function DevTab({
  settings,
  onPatchDev,
  onOpenContextDebugger,
}: {
  settings: AgentSettings
  onPatchDev: (patch: Partial<AgentDevSettings>) => void
  onOpenContextDebugger: () => void
}) {
  const [unlocked, setUnlocked] = useState(isDevUnlocked)
  if (!unlocked) {
    return (
      <div className={pane(4)}>
        <section>
          <p className="mb-3 text-[11.5px] leading-relaxed text-ink-faint">
            {t('这一页平时不显示。输入口令解锁（与全局设置里的开发者分页共用），解锁后会记住。')}
          </p>
          {/* 口令解锁（与全局设置的开发者分页共用同一个凭据：解锁一次，两边都亮） */}
          <DevUnlock
            inputClass="min-w-0 rounded-lg border border-line bg-card px-3 py-2 text-[12px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/60 focus:ring-2 focus:ring-seal/15 w-[240px] font-mono"
            onUnlocked={() => setUnlocked(true)}
          />
        </section>
      </div>
    )
  }
  const on = settings.dev?.contextDebugger === true
  return (
    <div className={pane(4)}>
      {/* 上下文比对调试器 */}
      <section className="rounded-lg border border-line bg-card px-3.5 py-3">
        <Switch
          on={on}
          onChange={(next) => onPatchDev({ contextDebugger: next })}
          label={t('启用上下文比对调试器')}
          hint={t('每次把上下文发往 API 之前记录一份快照（系统提示词 + 全部消息 + 工具声明）')}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {t('前缀缓存按逐字节匹配，命中率低几乎总是「某段上下文在两轮之间悄悄变了」。 调试器把两份快照逐条比对，差异直接定位到第几条消息、第几个字符。')}
        </p>
        <div className="mt-2.5">
          <button
            type="button"
            disabled={!on}
            onClick={onOpenContextDebugger}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] text-ink-soft transition hover:border-seal/50 hover:text-seal disabled:pointer-events-none disabled:opacity-40"
          >
            <Bug size={14} />
            {t('打开调试器')}
          </button>
        </div>
      </section>

      {/* execute 工具 api 上下文管理 */}
      <section className="rounded-lg border border-line bg-card px-3.5 py-3">
        <div className="text-[12.5px] font-medium text-ink-strong">{t('execute 工具 api 上下文管理')}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
          {t('当前 agent 在沙箱里可用的全部 api。用法写进系统提示词的那份（learn/ai 的 EXECUTE_GUIDE） 与这里是同一份能力的两个视图；模型调了不存在的 api 会得到「沙箱里没有这个 api」。')}
        </p>
        <div className="mt-2.5 flex flex-col gap-2.5">
          {SANDBOX_API_CATALOG.map((group) => (
            <div key={group.key} className="overflow-hidden rounded-lg border border-line">
              <div className="border-b border-line bg-paper-deep/60 px-3 py-1.5">
                <span className="text-[12px] font-medium text-ink-strong">{t(group.label)}</span>
                <span className="ml-2 text-[10.5px] text-ink-faint">{t('{0} 个 api', group.items.length)}</span>
              </div>
              <p className="px-3 py-1.5 text-[10.5px] leading-relaxed text-ink-faint">{t(group.intro)}</p>
              <ul className="divide-y divide-line/60">
                {group.items.map((item) => (
                  <li key={item.name} className="flex flex-col gap-0.5 px-3 py-1.5">
                    <div className="flex items-baseline gap-2">
                      <code className="shrink-0 rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[11px] text-seal-deep">
                        api.{item.signature}
                      </code>
                      {item.availability && item.availability !== 'always' && (
                        <span className="shrink-0 rounded bg-line/60 px-1.5 py-px text-[10px] text-ink-soft">
                          {item.availability === 'exam' ? t('有考试工具时') : t('主窗口界面在场时')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed text-ink-soft">{t(item.summary)}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-lg border border-line bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        {t('这些都是调试工具，普通使用不需要打开它们。快照只留在内存里，关掉应用就没了；也不会发往任何服务。')}
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

/**
 * 工作流列表：三级各一段，一条一行（名字、分级徽标、说明、指令体量）。
 * 可跑的给「运行」；登记的（全局 / 目标级）给「删除」——删之前弹一次确认。
 * 每行还有一个「思考」档位选择（三态，见 WorkflowEffortSetting）：工作流轮的档位
 * 独立于聊天滑条——出卷要深、探针要快，一个全局滑条伺候不了所有任务。
 * 登记本身不在这里做：在对话里让超级导师用 api.wf.create 落地（那是它展示能力的地方）。
 */
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
        <code className="mx-1 rounded bg-paper-deep px-1 py-px font-mono text-[10.5px] text-seal-deep">api.wf.create</code>
        {t('完成，这里会立刻看到。')}
      </p>

      {FLOW_TIERS.map(({ tier, label, hint, badge }) => {
        const items = rows.filter((r) => r.tier === tier)
        return (
          /*
           * shrink-0 不是顺手加的，它是这一段能不能滚的关键：
           * 滚动容器是 flex 列，每段自己又带 overflow-hidden（为了圆角裁边），
           * 而按 flexbox 的规矩，overflow 不是 visible 的 flex 项，自动最小尺寸按 0 算——
           * 于是三段会被**压扁**进容器高度里，各自把自己最后几行裁掉：
           * 看起来正是「列表溢出、怎么滚都滚不动」。带 shrink-0 才是
           * 「各段保持自然高度 + 由容器滚动」。
           * （同样写法在别处也踩过：见 agent/ContextDebugger 那份记录列表。）
           */
          <section key={tier} className="shrink-0 overflow-hidden rounded-lg border border-line">
            <div className="border-b border-line bg-paper-deep/60 px-3.5 py-2">
              <span className="text-[12.5px] font-medium text-ink-strong">{t(label)}</span>
              <span className="ml-2 text-[10.5px] text-ink-faint">{t('{0} 条 · {1}', items.length, t(hint))}</span>
            </div>
            {items.length ? (
              <ul className="divide-y divide-line/60">
                {items.map((row) => (
                  <li key={row.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12.5px] font-medium text-ink-strong">{t(row.name)}</span>
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
                          className="rounded-md border border-line bg-card px-1.5 py-1 text-[11.5px] text-ink-soft outline-none transition focus:border-seal/60"
                        >
                          {/* 「默认」只对内置有意义——它背后是 BUILTIN_DEFS 的推荐档；登记的没有推荐，落点就是跟随聊天 */}
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

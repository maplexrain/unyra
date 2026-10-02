/*
 * 这个文件负责：工作区的三块「外壳」视图——
 * 顶栏与面包屑（Topbar / NodeTrail）、文档列里的节点提示与空态（NodeHints / EmptyDoc）、
 * 以及还没有任何目标时的初始页（GoalInput）。
 *
 * 它们都是纯展示：数据与回调全部由 props 传入，不读 store 的派生逻辑、也不碰磁盘。
 * 原先它们与工作区本体挤在同一个文件里，搬出来之后「改顶栏一颗按钮」不必再翻三千行正文。
 */

import { useMemo, useState, type ReactNode } from 'react'
import { ArrowUp, BookOpen, Contact, Loader2, Menu, Monitor, Moon, Sun } from 'lucide-react'
import type { KnowledgeNode, LearnStore } from '../../../learn/types'
import { nodeById, pathToRoot, unmetPrereqs } from '../../../learn/graph'
import { plainSnippet } from '../../../learn/text'
import { NO_AUTOFILL } from '../../../lib/autofill'
import {
  THEME_LABEL,
  getAppearance,
  isDarkTheme,
  setAppearance,
  useAppearance,
  type ThemeMode,
} from '../../../lib/appearance'
import type { User } from '../../../user/types'
import UserMenu from '../../user/UserMenu'
import UpdateButton from '../../update/UpdateButton'
import WindowControls from '../../WindowControls'
import Bullseye from '../../Bullseye'
import GoalParticles from '../GoalParticles'
import ModelPicker from '../../agent/ModelPicker'
import { t } from '../../../i18n'

export function Topbar({
  activeNode,
  onSelectNode,
  goalQuestion,
  store,
  user,
  onOpenSidebar,
  onOpenUser,
  onSignOut,
  onOpenSettings,
  onOpenUpdate,
  onToast,
  pomodoro,
  checkin,
  review,
  reading,
}: {
  /** 番茄钟入口（墙上时钟 + 进度条 + 倒计时，见下面的 PomodoroDock） */
  pomodoro: ReactNode
  /** 打卡入口（今天的状态 + 日历 tip，见下面的 CheckinDock） */
  checkin: ReactNode
  /** 复习入口（到期清单 + 未来两周 + 补建，见下面的 ReviewDock） */
  review: ReactNode
  /** 有效阅读入口（今天读了多久 + 节点清单 + 近七天，见下面的 ReadingDock） */
  reading: ReactNode
  /** **当前文档指向的那个节点**（本地文件页签、或一个页签都没有时为 null） */
  activeNode: KnowledgeNode | null
  /** 面包屑点某一级 → 跳到那个祖先节点 */
  onSelectNode: (id: string) => void
  goalQuestion: string
  store: LearnStore
  user: User | null
  onOpenSidebar: () => void
  onOpenUser: () => void
  onSignOut: () => void
  onOpenSettings: () => void
  onOpenUpdate: () => void
  /** 顶栏那几个「还没做好」的按钮据此说明一句，而不是点了没反应 */
  onToast: (msg: string) => void
}) {
  const appearance = useAppearance()

  return (
    /*
      这一层必须自带 z-index：backdrop-blur 会让顶栏成为层叠上下文，
      于是里面那个 z-30 的下拉菜单被封在顶栏这一层里，只能按「顶栏的位置」
      参与绘制。而 AI 面板里助手消息那层是 position: relative（z-index auto），
      在 DOM 里排在顶栏之后——同层级里靠后者压前者，菜单就被消息盖住了。
      给顶栏一个正数 z-index，整个顶栏（连同菜单）才真正浮在正文之上。
      取 20 是留出层次：正文浮层（z-30）在它上面，移动端抽屉与其遮罩（z-30/40）、
      各类弹窗（z-50/60）也在它上面。
    */
    <div className="app-drag no-print relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-gradient-to-b from-card/90 to-paper/70 px-3 backdrop-blur">
      <button
        type="button"
        title={t('打开知识节点')}
        onClick={onOpenSidebar}
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink md:hidden"
      >
        <Menu size={17} />
      </button>

      {/* 目标名：应用的身份区，同时也是拖窗口的手感区。
          logo 与「已掌握 x/y」都不在这里了——侧栏本来就有 logo，掌握进度要看去状态面板，
          顶栏每多一个徽标，真正要看的「目标是什么」就淡一分 */}
      <div className="flex min-w-0 items-center gap-2.5">
        {goalQuestion ? (
          <>
            <Bullseye size={14} className="shrink-0 text-seal" />
            {/* 宽度收窄一档：右边还挤着「当前位置」那一簇（见 NodeTrail） */}
            <span className="max-w-[26vw] truncate text-[13px] text-ink-strong" title={goalQuestion}>
              {goalQuestion}
            </span>
          </>
        ) : (
          <span className="text-[13px] font-medium tracking-wide text-ink-soft">归一</span>
        )}
      </div>

      {/* 当前位置（面包屑）：从文档区顶上那条面包屑行上移过来，正文区因此省下一行 */}
      <NodeTrail node={activeNode} store={store} onSelect={onSelectNode} />

      {/* 右侧只留账号与窗口控制：保存状态与「新建目标」都不再放进顶栏——
          数据本就是实时保存的，而新建目标与知识节点栏右上角那颗按钮是同一件事 */}
      <div className="ml-auto flex items-center gap-1.5">
        {/* 更新入口：只有新版本**下载完成**之后它才存在，见 components/update/UpdateButton */}
        <UpdateButton onOpenUpdate={onOpenUpdate} />
        {/* 四个入口都是「我今天的节奏」，与账号那一簇同属右侧。
            番茄钟排在最前：它是唯一一个「开始之后不看也要一直在跑」的东西，
            固定在最左边，开关它的时候手指不必每次都去找位置 */}
        {pomodoro}
        {reading}
        {checkin}
        {review}
        <UserMenu
          user={user}
          onOpenUser={onOpenUser}
          onOpenSettings={onOpenSettings}
          onSignOut={onSignOut}
        />

        {/*
          主题：点一下在「跟随系统 → 浅色 → 深色」之间轮换。
          为什么是轮换而不是弹出三选一：它是个高频的小动作（夜里换成深色、白天换回来），
          轮换两次之内一定能到想要的档位，而菜单要「展开 → 选 → 收起」三步。
          图标本身就是当前档位（显示器 / 太阳 / 月亮），不必再解释。
        */}
        {/*
          主题：快速按钮只在「跟随系统 → 浅色 → 深色」之间轮换（高频的小动作）；
          粉 / 蓝 / 绿 / 纯白 / 纯黑这些独立配色是低频选择，入口归设置页——
          从扩展主题点这一下会先落到浅色，再点就是熟悉的三档轮换。
        */}
        <button
          type="button"
          title={t('主题：{0}（点击切换，更多主题在设置里）', t(THEME_LABEL[appearance.theme]))}
          onClick={() => {
            const next: ThemeMode =
              appearance.theme === 'system'
                ? 'light'
                : appearance.theme === 'light'
                  ? 'dark'
                  : appearance.theme === 'dark'
                    ? 'system'
                    : 'light'
            setAppearance({ ...getAppearance(), theme: next })
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
        >
          {appearance.theme === 'system' ? (
            <Monitor size={16} />
          ) : isDarkTheme(appearance.theme) ? (
            <Moon size={16} />
          ) : (
            <Sun size={16} />
          )}
        </button>

        {/* 文档与联系方式：位置先占住（需求里明确说「先留空」），点了说明白还没做好 */}
        <button
          type="button"
          title={t('文档')}
          onClick={() => onToast(t('「文档」还在做：之后这里放教学文档的入口'))}
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/70 hover:text-ink"
        >
          <BookOpen size={16} />
        </button>
        <button
          type="button"
          title={t('联系方式')}
          onClick={() => onToast(t('「联系方式」还是空的：之后放反馈与作者的入口'))}
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/70 hover:text-ink"
        >
          <Contact size={16} />
        </button>

        <WindowControls />
      </div>
    </div>
  )
}

/* ---------- 文档列里的节点提示 / 空态 ---------- */


/**
 * 节点关系提示：还差哪些前置没掌握。
 *
 * 它原先挤在文档栏那一行里（与文档标签、试卷入口同一行）。页签接管那一行之后，
 * 这一块单独留在这里：它说的是**当前这个节点**的处境，与「正开着哪份文档」无关，
 * 因此不跟着页签走，也不必占页签栏的地方。不常出现，出现时才多占一行。
 *
 * 「前置已就绪，可以回溯」那一条**删掉了**（用户定的）：节点掌握之后，这一格顶上
 * 就冒出一条提示加一串跳转按钮，而掌握本身就是「可以往下走了」——该去哪儿由学习状态
 * 与那棵树说了算（状态现在是侧栏标题前的那颗标记）。一句每次都冒出来的提示，
 * 只会把正文往下挤。
 */
export function NodeHints({ node, store }: { node: KnowledgeNode; store: LearnStore }) {
  const rootId = store.goals.find((g) => g.id === node.goalId)?.rootNodeId ?? null
  const unmet = useMemo(() => unmetPrereqs(store, node.id), [store, node])

  if (node.status === 'mastered' || node.id === rootId || !unmet.length) return null

  return (
    <div className="no-print shrink-0 border-b border-line bg-paper/30">
      <p className="px-3 py-1.5 text-[11.5px] leading-relaxed text-ink-faint">
        {t('还差这些前置未掌握：{0}', unmet.map((u) => u.title).join('、'))}
      </p>
    </div>
  )
}

/**
 * 一个页签都没有时的文档区。
 *
 * 页签是可以全部关掉的（右键菜单里就有「全部关闭」），那时给一句话说清去哪儿找东西，
 * 而不是留一片白——空白面板看起来像坏了。
 */
export function EmptyDoc({ onPickLocal, onOpenWeb }: { onPickLocal: () => void; onOpenWeb?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-[13px] text-ink-soft">{t('没有打开的文档')}</p>
      <p className="max-w-[380px] text-[11.5px] leading-relaxed text-ink-faint">
        {t('点左侧资源管理器里的知识点，会在这里开一个页签；也可以把 txt / markdown 文件 拖进窗口，或')}
        <button
          type="button"
          onClick={onPickLocal}
          className="mx-0.5 rounded px-1 text-seal-deep underline decoration-dotted underline-offset-2 transition hover:bg-seal/10"
        >
          {t('打开一个本地文件')}
        </button>
        {onOpenWeb && (
          <>
            {t('，或')}
            <button
              type="button"
              onClick={onOpenWeb}
              className="mx-0.5 rounded px-1 text-seal-deep underline decoration-dotted underline-offset-2 transition hover:bg-seal/10"
            >
              {t('打开一个网页')}
            </button>
          </>
        )}
        。
      </p>
    </div>
  )
}


/**
 * 顶栏里的「我在哪」：一条面包屑。
 *
 * 这一簇原先是文档区顶上的一条独立行，现在提到顶栏：左边是「学什么」（目标），
 * 右边是「学到哪」（当前节点），一行读完，正文区省下一行。
 *
 * 学习状态徽标与关系摘要（前置几个、被几个依赖）都从这儿撤了：它们是次要信息，
 * 常驻顶栏只会把面包屑挤成一段省略号——状态面板与节点详情才是它们该在的地方。
 *
 * 停在目标根节点上时不画面包屑——那一段与左边的目标名重复。
 */
export function NodeTrail({
  node,
  store,
  onSelect,
}: {
  node: KnowledgeNode | null
  store: LearnStore
  onSelect: (id: string) => void
}) {
  const rootId = node ? (store.goals.find((g) => g.id === node.goalId)?.rootNodeId ?? null) : null

  if (!node) return null
  const trail = (rootId ? pathToRoot(store, rootId, node.id) : null) ?? []

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-ink-faint">
      <span className="mx-0.5 h-5 w-px shrink-0 bg-line-strong/60" />

      {/* 面包屑本身就是入口：点任意一级回到那个祖先节点 */}
      {trail.length > 1 &&
        trail.map((id, i) => {
          const n = nodeById(store, id)
          if (!n) return null
          const last = i === trail.length - 1
          return (
            <span key={id} className="flex min-w-0 items-center gap-1">
              {i > 0 && <span className="shrink-0 text-line-strong">›</span>}
              <button
                type="button"
                onClick={() => onSelect(id)}
                disabled={last}
                // 悬停显示该节点的描述（描述不再占用正文版面）
                title={n.description ? `${n.title}\n\n${plainSnippet(n.description, 600)}` : n.title}
                className={`min-w-0 max-w-[11em] truncate rounded px-1 py-px transition ${
                  last ? 'font-medium text-ink-strong' : 'hover:bg-line/60 hover:text-ink'
                }`}
              >
                {n.title}
              </button>
            </span>
          )
        })}

      {node.id === rootId && (
        <span className="shrink-0 rounded border border-line bg-paper px-1.5 py-px text-[10px] text-ink-faint">
          {t('目标')}
        </span>
      )}
    </div>
  )
}

/* ---------- 初始页 ---------- */

export function GoalInput({
  busy,
  hasGoals,
  onSubmit,
  onModelChanged,
}: {
  busy: boolean
  hasGoals: boolean
  onSubmit: (q: string) => void
  /** 模型选择器改了全局默认后的回调（外层据此刷新 hasKey 等派生状态） */
  onModelChanged: () => void
}) {
  const [value, setValue] = useState('')
  const submit = () => {
    if (!value.trim() || busy) return
    onSubmit(value)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-card px-6 py-10">
      {/* 背景粒子：只在最外面这层铺满，内容层用 relative 压在上面 */}
      <GoalParticles />

      {/* 加宽到 860px：输入框更接近参考图那种「一横条」的观感 */}
      <div className="relative my-auto w-full max-w-[860px]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-12 w-12 select-none items-center justify-center rounded-xl bg-seal/10 text-seal">
            <Bullseye size={26} />
          </div>
          <div>
            <h1 className="text-[20px] font-semibold text-ink-strong">
              {hasGoals ? t('开始一个新的学习目标') : t('从一个目标开始')}
            </h1>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              {t('写下想弄懂的问题，超级导师会陪你把它逐层拆开')}
            </p>
          </div>
        </div>

        {/*
          输入区做成一个整体卡片（参照参考图）：
          上半是输入框，下半是一条工具条——左侧放操作、右侧放模型选择与发送。
          两者同在一个边框里，视觉上是一个整体而不是「输入框 + 一排按钮」。
        */}
        <div className="mt-5 rounded-2xl border border-line bg-paper shadow-sm transition focus-within:border-seal/50 focus-within:ring-2 focus-within:ring-seal/10">
          <textarea
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              // 直接 Enter 就开讲（Shift+Enter 换行）；输入法组字期间不拦，
              // 否则中文候选词选到一半就被提交了
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            rows={4}
            placeholder={t('例如：为什么 Transformer 能处理长距离依赖？')}
            className="block min-h-[112px] w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3.5 pb-2 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
            {...NO_AUTOFILL}
          />

          <div className="flex items-center gap-2 rounded-b-2xl px-3 py-2">
            {/* 左：留白（没有快捷提问，也不放别的元素，保持输入区干净） */}
            <div className="min-w-0 flex-1" />

            {/* 右：模型选择 + 发送，与参考图的右下角一致 */}
            <div className="flex shrink-0 items-center gap-1.5">
              <ModelPicker onChanged={onModelChanged} />
              <button
                type="button"
                onClick={submit}
                disabled={!value.trim() || busy}
                title={t('开始学习（Enter）')}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-paper shadow-sm transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-35"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
              </button>
            </div>
          </div>
        </div>

        {/* 不再放「取消」按钮：这一页要么提交，要么点左上角换目标，多一个出口只是噪音 */}
        <div className="mt-3 flex items-center justify-end">
          <span className="text-[11px] text-ink-faint">{t('Enter 开始 · Shift + Enter 换行')}</span>
        </div>
      </div>
    </div>
  )
}
/*
 * 这个文件负责：工作区的三块「外壳」视图——
 * 顶栏与面包屑（Topbar / NodeTrail）、文档列里的节点提示与空态（NodeHints / EmptyDoc）、
 * 以及还没有任何目标时的初始页（GoalInput）。
 *
 * 它们都是纯展示：数据与回调全部由 props 传入，不读 store 的派生逻辑、也不碰磁盘。
 * 原先它们与工作区本体挤在同一个文件里，搬出来之后「改顶栏一颗按钮」不必再翻三千行正文。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Check, ChevronDown, Compass, FilePlus, FolderOpen, Globe, History, Loader2, Menu, Paperclip, Sparkles, Star, X } from 'lucide-react'
import type { PendingFile } from '../../../agent/types'
import type { FavoriteItem, FavoriteRef, KnowledgeNode, LearnStore } from '../../../learn/types'
import { favoriteKey } from '../../../learn/favorites'
import type { RecentOpen } from '../../../learn/recents'
import { useClock } from '../../../lib/clock'
import { nodeById, pathToRoot } from '../../../learn/graph'
import { plainSnippet } from '../../../learn/text'
import { pendingFromFile, pendingFromRead } from '../../../learn/attachments'
import { isElectron, isMac, native } from '../../../lib/native'
import { NO_AUTOFILL } from '../../../lib/autofill'
import { useClampToViewport, useDismissOn } from '../../../lib/useDismiss'
import {
  THEME_LABEL,
  THEME_MODES,
  THEME_SWATCH,
  getAppearance,
  setAppearance,
  useAppearance,
  type ThemeMode,
} from '../../../lib/appearance'
import type { User } from '../../../user/types'
import UserMenu from '../../user/UserMenu'
import UpdateButton from '../../update/UpdateButton'
import NoticeButton from '../../notice/NoticeButton'
import WindowControls from '../../WindowControls'
import Bullseye from '../../Bullseye'
import Logo from '../../Logo'
import GoalParticles from '../GoalParticles'
import ModelPicker from '../../agent/ModelPicker'
import { FileChip } from '../../agent/panel/Images'
import { RecentRow } from '../explorer/sections'
import { DocTypeIcon, WebTabTypeIcon } from '../docTypes'
import TopBarTipCarousel from './TopBarTipCarousel'
import { t } from '../../../i18n'

export function Topbar({
  activeNode,
  onSelectNode,
  goalQuestion,
  tabGroups,
  onSwitchGoalGroup,
  onDropGoalCache,
  store,
  user,
  onOpenSidebar,
  onOpenUser,
  onSignOut,
  onOpenSettings,
  onOpenUsage,
  onOpenUpdate,
  onOpenNotice,
  onToast: _onToast,
  pomodoro,
  reading,
}: {
  /** 番茄钟入口（墙上时钟 + 进度条 + 倒计时，见下面的 PomodoroDock） */
  pomodoro: ReactNode
  /** 有效阅读入口（今天读了多久 + 节点清单 + 近七天，见下面的 ReadingDock） */
  reading: ReactNode
  /** **当前文档指向的那个节点**（本地文件页签、或一个页签都没有时为 null） */
  activeNode: KnowledgeNode | null
  /** 面包屑点某一级 → 跳到那个祖先节点 */
  onSelectNode: (id: string) => void
  goalQuestion: string
  /**
   * **存活的 tab 组**：目标名下还有实体页签留在文档区里的目标（看得见 + 切走收起来的
   * 都算），按目标的先后排。目标名点开的下拉菜单列的就是它，点一行切过去。
   */
  tabGroups: Array<{ goalId: string; title: string; count: number; current: boolean }>
  /** 切到一个目标的 tab 组（不强制落回大纲：那个组正开着什么就接着看什么） */
  onSwitchGoalGroup: (goalId: string) => void
  /** 清空该目标的 tab 组缓存（移出停靠场与当前活动页签） */
  onDropGoalCache?: (goalId: string) => void
  store: LearnStore
  user: User | null
  onOpenSidebar: () => void
  onOpenUser: () => void
  onSignOut: () => void
  onOpenSettings: () => void
  /** 打开用量统计页签（入口在用户菜单，见 UserMenu） */
  onOpenUsage: () => void
  onOpenUpdate: () => void
  /** 打开公告弹窗（弹窗由 App 渲染，理由见 components/notice/NoticeDialog） */
  onOpenNotice: () => void
  /** 顶栏那几个「还没做好」的按钮据此说明一句，而不是点了没反应 */
  onToast: (msg: string) => void
}) {
  const appearance = useAppearance()
  /** 主题按钮的右键菜单：完整主题列表弹在这；null = 没弹 */
  const [themeMenu, setThemeMenu] = useState<{ x: number; y: number } | null>(null)
  /** 目标名的下拉菜单（存活的 tab 组列表）；null = 没弹 */
  const [goalMenu, setGoalMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      {/*
        这一层必须自带 z-index：backdrop-blur 会让顶栏成为层叠上下文，
      于是里面那个 z-30 的下拉菜单被封在顶栏这一层里，只能按「顶栏的位置」
      参与绘制。而 AI 面板里助手消息那层是 position: relative（z-index auto），
      在 DOM 里排在顶栏之后——同层级里靠后者压前者，菜单就被消息盖住了。
      给顶栏一个正数 z-index，整个顶栏（连同菜单）才真正浮在正文之上。
      取 20 是留出层次：正文浮层（z-30）在它上面，移动端抽屉与其遮罩（z-30/40）、
        各类弹窗（z-50/60）也在它上面。
      */}
      <div
        className={
          'app-drag no-print relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-gradient-to-b from-card/90 to-paper/70 px-3 ' +
          (isElectron() && isMac() ? 'pl-[76px]' : '')
        }
      >
      <button
        type="button"
        title={t('打开知识节点')}
        onClick={onOpenSidebar}
        className="flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-ink-soft transition hover:text-ink md:hidden"
      >
        <Menu size={17} />
      </button>

      {/* 目标名：应用的身份区，同时也是拖窗口的手感区。
          logo 与「已掌握 x/y」都不在这里了——侧栏本来就有 logo，掌握进度要看去状态面板，
          顶栏每多一个徽标，真正要看的「目标是什么」就淡一分。
          点它弹**存活的 tab 组**下拉（见 GoalGroupsMenu）：切目标不必绕回侧栏树。 */}
      <div className="flex min-w-0 items-center gap-2.5">
        {goalQuestion ? (
          <>
            <Bullseye size={14} className="shrink-0 text-seal" />
            {/* 宽度收窄一档：右边还挤着「当前位置」那一簇（见 NodeTrail） */}
            <button
              type="button"
              title={t('切换目标页签组')}
              aria-haspopup="menu"
              aria-expanded={!!goalMenu}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setGoalMenu((cur) => (cur ? null : { x: r.left, y: r.bottom + 4 }))
              }}
              className={
                'flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[13px] font-medium transition hover:bg-line/60 ' +
                (goalMenu ? 'bg-line/60 text-ink-strong' : 'text-ink-strong')
              }
            >
              <span className="max-w-[24vw] truncate">{goalQuestion}</span>
              <ChevronDown size={12} className="shrink-0 text-ink-faint" />
            </button>
          </>
        ) : tabGroups.length > 0 ? (
          <button
            type="button"
            title={t('选择页签组')}
            aria-haspopup="menu"
            aria-expanded={!!goalMenu}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setGoalMenu((cur) => (cur ? null : { x: r.left, y: r.bottom + 4 }))
            }}
            className={
              'flex min-w-0 items-center gap-1.5 rounded-lg border border-seal/60 bg-seal/10 px-2 py-0.5 text-[12px] font-medium text-seal transition hover:bg-seal/15 animate-pulse shadow-sm shadow-seal/20 ' +
              (goalMenu ? 'ring-2 ring-seal/40' : '')
            }
          >
            <Bullseye size={13} className="shrink-0 text-seal" />
            <span>{t('请选择页签组')}</span>
            <ChevronDown size={12} className="shrink-0 text-seal" />
          </button>
        ) : (
          <span className="text-[13px] font-medium tracking-wide text-ink-soft">{t('归一')}</span>
        )}
      </div>

      {/* 当前位置（面包屑）：从文档区顶上那条面包屑行上移过来，正文区因此省下一行 */}
      <NodeTrail node={activeNode} store={store} onSelect={onSelectNode} />

      {/* 居中轮播 Tip：隐藏小技巧（置于中间自适应弹性空间中居中，永不遮挡右侧按钮） */}
      {appearance.showTips !== false && (
        <div className="mx-2 hidden min-w-0 flex-1 items-center justify-center overflow-hidden lg:flex">
          <TopBarTipCarousel />
        </div>
      )}

      {/* 右侧只留账号与窗口控制：保存状态、「新建目标」与「新页签」都不在顶栏——
          数据本就是实时保存的；新建目标与知识节点栏右上角那颗按钮是同一件事；
          新页签搬去了它真正长出来的地方（文档区页签栏最后一枚页签后面，见 TabBar 的 onNewTab） */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* 更新入口：只有新版本**下载完成**之后它才存在，见 components/update/UpdateButton */}
        <UpdateButton onOpenUpdate={onOpenUpdate} />
        {/* 两个入口都是「我今天的节奏」，与账号那一簇同属右侧。
            番茄钟排在最前：它是唯一一个「开始之后不看也要一直在跑」的东西，
            固定在最左边，开关它的时候手指不必每次都去找位置 */}
        {pomodoro}
        {reading}
        <UserMenu
          user={user}
          onOpenUser={onOpenUser}
          onOpenSettings={onOpenSettings}
          onOpenUsage={onOpenUsage}
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
        <div className="mx-0.5 h-4 w-px bg-line/60" />

        <button
          type="button"
          title={t('主题：{0}（点击切换，右键看全部主题）', t(THEME_LABEL[appearance.theme]))}
          onContextMenu={(e) => {
            // 右键不弹系统的，弹完整的主题列表（低频的扩展配色走这条路，左键仍是三档快切）
            e.preventDefault()
            setThemeMenu({ x: e.clientX, y: e.clientY })
          }}
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
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-all hover:bg-line/60 hover:text-ink"
        >
          {appearance.theme === 'system' ? (
            <Monitor size={15} />
          ) : isDarkTheme(appearance.theme) ? (
            <Moon size={15} />
          ) : (
            <Sun size={15} />
          )}
        </button>

        {/* 公告：这里原先占位的是「文档」按钮（那个入口一直没做，现在整颗删掉，
            位置让给公告）。按钮自己订阅公告状态、自己画那颗未读红点（见
            components/notice/NoticeButton）——顶栏这一层保持纯展示。 */}
        <NoticeButton onOpen={onOpenNotice} />


        <WindowControls />
      </div>
      </div>

      {/*
        主题菜单必须渲染在顶栏那个 div **外面**：顶栏的 backdrop-blur 会把自己变成
        fixed 定位的包含块，菜单的 fixed 坐标会被解释成「相对顶栏」，弹到视口外去。
        目标名的 tab 组菜单同一个道理。
      */}
      {goalMenu && (
        <GoalGroupsMenu
          menu={goalMenu}
          groups={tabGroups}
          onPick={(goalId) => {
            onSwitchGoalGroup(goalId)
            setGoalMenu(null)
          }}
          onDropGoalCache={onDropGoalCache}
          onClose={() => setGoalMenu(null)}
        />
      )}
      {themeMenu && (
        <ThemeMenu
          menu={themeMenu}
          current={appearance.theme}
          onPick={(mode) => {
            setAppearance({ ...getAppearance(), theme: mode })
            setThemeMenu(null)
          }}
          onClose={() => setThemeMenu(null)}
        />
      )}
    </>
  )
}

/**
 * 主题按钮的右键菜单：全部主题（含左键轮换里轮不到的扩展配色）一次列全。
 *
 * 左键仍是「跟随系统 → 浅色 → 深色」的三档快切（高频动作，两次之内必到）；
 * 暖纸、石墨、纯黑这些低频选择归这条菜单——不用再绕去设置页。
 * 每行左侧一枚小色板（这套主题的纸色 + 强调色圆点，见 lib/appearance 的 THEME_SWATCH），
 * 当前档位带一枚勾。
 */
function ThemeMenu({
  menu,
  current,
  onPick,
  onClose,
}: {
  menu: { x: number; y: number }
  current: ThemeMode
  onPick: (mode: ThemeMode) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)
  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="moji-in-soft fixed z-[70] max-h-[70vh] min-w-[172px] max-w-[240px] overflow-y-auto rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      {THEME_MODES.map((mode) => {
        const on = mode === current
        const swatch = THEME_SWATCH[mode]
        return (
          <button
            key={mode}
            type="button"
            role="menuitem"
            onClick={() => onPick(mode)}
            className={
              'flex w-full items-center gap-2.5 rounded-md py-1.5 pl-2 pr-2.5 text-left text-[12px] transition hover:bg-line/60 ' +
              (on ? 'font-medium text-ink-strong' : 'text-ink')
            }
          >
            {/* 色板：纸色打底、强调色一枚圆点——不看名字也能认出是哪套配色 */}
            <span
              aria-hidden="true"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-strong"
              style={{ background: swatch.paper }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: swatch.accent }} />
            </span>
            <span className="min-w-0 flex-1 truncate">{t(THEME_LABEL[mode])}</span>
            {on && <Check size={13} className="shrink-0 text-seal" />}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 顶栏目标名的下拉菜单：**存活的 tab 组**列表，点一行切过去。
 *
 * 「存活」= 这个目标的页签此刻真的有实体留在文档区里（看得见的那几枚 + 切走时收起来
 * 的那几枚都算）。空组（还没开过 / 全关光了）不在这里出现——那种目标从侧栏切就行；
 * 这里回答的是「我刚才那几个目标分别开着什么，一按切回去」。行尾的数字是那一组的页签数，
 * 当前所在的一组带勾。菜单与主题菜单同一套开合与夹取（见 useDismissOn / useClampToViewport）。
 */
function GoalGroupsMenu({
  menu,
  groups,
  onPick,
  onDropGoalCache,
  onClose,
}: {
  menu: { x: number; y: number }
  groups: Array<{ goalId: string; title: string; count: number; current: boolean }>
  onPick: (goalId: string) => void
  onDropGoalCache?: (goalId: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)
  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="moji-in-soft fixed z-[70] min-w-[220px] max-w-[330px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      <div className="px-2.5 py-1 text-[10.5px] text-ink-faint">{t('目标页签组（点一行切过去）')}</div>
      {groups.length ? (
        groups.map((g) => (
          <div
            key={g.goalId}
            className="group/item flex w-full items-center gap-1 rounded-md py-0.5 pl-2 pr-1.5 transition hover:bg-line/60"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => onPick(g.goalId)}
              className={
                'flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-[12px] ' +
                (g.current ? 'font-medium text-ink-strong' : 'text-ink')
              }
            >
              <Bullseye size={12} className={'shrink-0 ' + (g.current ? 'text-seal' : 'text-ink-faint')} />
              <span className="min-w-0 flex-1 truncate">{g.title}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">{g.count}</span>
              {g.current && <Check size={12} className="shrink-0 text-seal" />}
            </button>
            {onDropGoalCache && (
              <button
                type="button"
                title={t('清空该组缓存')}
                aria-label={t('清空该组缓存')}
                onClick={(e) => {
                  e.stopPropagation()
                  onDropGoalCache(g.goalId)
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-line hover:text-ink-strong group-hover/item:opacity-100 cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))
      ) : (
        <div className="px-2.5 py-2 text-[11px] leading-relaxed text-ink-faint">
          {t('还没有存活的页签组：切到某个目标，开一份文档就会出现在这里')}
        </div>
      )}
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
export function NodeHints(_props: { node?: KnowledgeNode; store?: LearnStore }) {
  return null
}

/**
 * 一个页签都没有时的文档区，同时也是「新页签」开出来的那一页（空白页签）。
 *
 * 页签是可以全部关掉的（右键菜单里就有「全部关闭」），那时给一句话说清去哪儿找东西，
 * 而不是留一片白——空白面板看起来像坏了。
 *
 * 它**没有卡片外壳**（用户定的）：它是画布上的落墨处，不是一张浮起来的卡片。
 * 版式按设计稿定的四条：
 * - 整体**上移**（不再垂直居中），从上方一块留白起步；
 * - 顶部是**应用标志**：不带徽章边框与底色，就是 logo 本身；
 * - 快捷入口的图标**加大、去掉边框与背景**，悬停反馈落在图标与文字的颜色上；
 * - 底部上下两栏：**收藏**在上、**最近打开**在下（原资源管理器侧栏的「最近打开」区挪到这里，
 *   见 learn/recents）；两栏都空时各自给一句「去哪儿攒」的说明。
 *
 * 快捷入口的第一个是**新建文件**（用户定的）：它是这一页自己的正事——「我要写点东西」。
 * 点它就地换成一枚新建文件页签（还没有类型，保存时才定，见 learn/types 的 draft 分支），
 * 所以它排在「打开本地文件」前面。
 *
 * 数据与回调全部由 props 传入（收藏、最近打开、四个入口、拖拽提示），组件自己不读 store。
 */
export function EmptyDoc({
  onNewFile,
  onPickLocal,
  onOpenWeb,
  onNewGoal,
  favorites = [],
  favoriteTitleOf,
  onOpenFavorite,
  recents = [],
  onOpenRecent,
}: {
  /** 新建文件：就地换成一枚临时编辑页签（见 learn/types 的 draft） */
  onNewFile?: () => void
  onPickLocal: () => void
  onOpenWeb?: () => void
  onNewGoal?: () => void
  /** 收藏栏的数据：store.favorites（按收藏时间倒序展示，见下） */
  favorites?: FavoriteItem[]
  /** 收藏行的标题（节点名 / 考试名要现查，与侧栏收藏区共用一份） */
  favoriteTitleOf?: (ref: FavoriteRef) => string
  onOpenFavorite?: (ref: FavoriteRef) => void
  /** 最近打开栏的数据：recentOpens(store) 的那一份 */
  recents?: RecentOpen[]
  onOpenRecent?: (item: RecentOpen) => void
}) {
  /** 那一列相对时间（「刚刚」→「3 分钟前」）要跟着真实时间走：时钟只订在这一页上 */
  const now = useClock(30_000)
  /** 收藏按收藏时间倒序：这一栏是「快速入口」，刚收进来的排前面 */
  const favs = useMemo(() => [...favorites].sort((a, b) => b.at - a.at), [favorites])
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6 text-center select-none animate-in fade-in duration-300">
      {/* 整体上移：从上方一块留白（8vh）起步，不再垂直居中 */}
      <div className="flex w-full max-w-[680px] flex-col items-center pt-[8vh] pb-10">
        {/* 应用标志：不带边框与底色，就是 logo 本身 */}
        <Logo size={52} />

        {/* 标题与副标题 */}
        <h3 className="mt-4 text-[16px] font-medium tracking-wide text-ink-strong">
          {t('书卷未启 · 随思落墨')}
        </h3>
        <p className="mt-1.5 max-w-[400px] text-[12px] leading-relaxed text-ink-soft">
          {t('点选左侧目录知识点开启研读，或通过下方快捷入口探索文件与网络。')}
        </p>

        {/* 快捷操作组：图标加大、去掉边框与背景，悬停反馈落在图标与文字上。
            四个入口**排成一行**（用户定的）：容器宽 680 时四张的说明文字都放得下，
            更窄时说明自动折行、卡片等高，不会挤坏；小屏退回一列 */}
        <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-4">
          {onNewFile && (
            <QuickEntry
              icon={<FilePlus size={22} className="stroke-[1.75]" />}
              label={t('新建文件')}
              hint={t('空白编辑页 · 保存时定类型')}
              onClick={onNewFile}
            />
          )}
          <QuickEntry
            icon={<FolderOpen size={22} className="stroke-[1.75]" />}
            label={t('打开本地文件')}
            hint={t('Markdown / TXT / 代码')}
            onClick={onPickLocal}
          />
          {onOpenWeb && (
            <QuickEntry
              icon={<Globe size={22} className="stroke-[1.75]" />}
              label={t('浏览网络网页')}
              hint={t('双链速记与知识批注')}
              onClick={onOpenWeb}
            />
          )}
          {onNewGoal && (
            <QuickEntry
              icon={<Compass size={22} className="stroke-[1.75]" />}
              label={t('新建学习目标')}
              hint={t('AI 生成体系化知识树')}
              onClick={onNewGoal}
            />
          )}
        </div>

        {/* 收藏 / 最近打开 两栏（用户定的：原侧栏的「最近打开」区挪到空白页上，上下排列，收藏在上、最近打开在下） */}
        <div className="mt-8 flex w-full flex-col gap-5 text-left">
          <BlankColumn title={t('收藏')} icon={<Star size={12} />}>
            {favs.length ? (
              <div className="max-h-[196px] overflow-y-auto">
                {favs.map((f) => (
                  <FavoriteRow
                    key={favoriteKey(f)}
                    item={f}
                    title={favoriteTitleOf ? favoriteTitleOf(f) : ''}
                    onOpen={onOpenFavorite ? () => onOpenFavorite(f) : undefined}
                  />
                ))}
              </div>
            ) : (
              <BlankColumnEmpty text={t('还没有收藏：在页签上右键即可收藏文档与网页')} />
            )}
          </BlankColumn>
          <BlankColumn title={t('最近打开')} icon={<History size={12} />}>
            {recents.length ? (
              <div className="max-h-[196px] overflow-y-auto">
                {recents.map((item) => (
                  <RecentRow
                    key={item.kind + ':' + item.id}
                    item={item}
                    now={now}
                    onOpen={() => onOpenRecent?.(item)}
                  />
                ))}
              </div>
            ) : (
              <BlankColumnEmpty text={t('还没有最近打开：读过的文档会记在这里')} />
            )}
          </BlankColumn>
        </div>

        {/* 底部拖拽与快捷操作提示 */}
        <div className="mt-6 flex items-center gap-1.5 text-[11px] text-ink-faint">
          <Sparkles size={11} className="text-seal/70" />
          <span>{t('小提示：可直接拖动外部文档或图片至窗口中任意位置查看')}</span>
        </div>
      </div>
    </div>
  )
}

/** 空白页上的快捷入口：图标加大、无边框无底色，悬停时图标与文字一起染上印章色 */
function QuickEntry({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-2 rounded-xl px-2.5 py-3.5 transition-colors duration-200 hover:bg-line/40 focus-visible:ring-2 focus-visible:ring-seal/50"
    >
      <span className="text-ink-soft transition-colors group-hover:text-seal">{icon}</span>
      <span className="text-[12.5px] font-medium text-ink transition-colors group-hover:text-seal-deep">{label}</span>
      <span className="text-[10.5px] text-ink-faint">{hint}</span>
    </button>
  )
}

/** 空白页底部两栏共同的骨架：一枚小图标 + 栏名 + 内容（或空态说明） */
function BlankColumn({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="flex items-center gap-1.5 px-2 pb-1 text-ink-faint">
        {icon}
        <span className="text-[11px] font-medium">{title}</span>
      </div>
      {children}
    </section>
  )
}

/** 栏空着时的一句话：说清「去哪儿攒」，而不是干摆一个空壳 */
function BlankColumnEmpty({ text }: { text: string }) {
  return <div className="px-2 py-2 text-[11px] leading-relaxed text-ink-faint/80">{text}</div>
}

/**
 * 收藏一行的紧凑版：侧栏 FavRow 的轻装（这里不打右键菜单、不拖拽，点一下就开）。
 * 图示与侧栏同一套：网页用站点图标，其余类型用类型图标——同一个东西在哪儿都长一样。
 */
function FavoriteRow({ item, title, onOpen }: { item: FavoriteItem; title: string; onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={item.kind === 'web' ? item.url : item.kind === 'local' ? item.path : title}
      className="flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1.5 text-left transition hover:bg-line/40"
    >
      {item.kind === 'web' ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <WebTabTypeIcon favicon={item.icon} size={13} />
        </span>
      ) : (
        <DocTypeIcon kind={item.kind} size={13} />
      )}
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{title}</span>
    </button>
  )
}


/**
 * 滚到最右端用的「足够大」的值。
 *
 * 为什么不是 `el.scrollWidth`：读它会把待处理的样式与布局**就地结算掉**（一次完整的
 * 布局，日志里量到约 0.5ms），而这一步在每次当前节点变化时都要走。给一个远超任何
 * 面包屑宽度的值，浏览器自己会夹到真实的最大滚动位置——同样滚到最右端，但不读几何。
 */
const SCROLL_TO_END = 1e7

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootId = node ? (store.goals.find((g) => g.id === node.goalId)?.rootNodeId ?? null) : null

  /*
   * 滚轮横滚：鼠标纵向滚轮也能横向平滑滚动面包屑，类似 tab 栏。
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!dx || el.scrollWidth <= el.clientWidth) return
      el.scrollLeft += dx
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 当前节点切换时，平滑滚动至最右端（当前节点）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: SCROLL_TO_END, behavior: 'smooth' })
  }, [node?.id])

  if (!node) return null
  const trail = (rootId ? pathToRoot(store, rootId, node.id) : null) ?? []

  return (
    <div
      ref={scrollRef}
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      className="no-drag flex min-w-0 max-w-[28vw] shrink-0 items-center gap-1 overflow-x-auto text-[11px] text-ink-faint [&::-webkit-scrollbar]:hidden"
    >
      <span className="mx-0.5 h-5 w-px shrink-0 bg-line-strong/60" />

      {/* 面包屑本身就是入口：点任意一级回到那个祖先节点 */}
      {trail.length > 1 &&
        trail.map((id, i) => {
          const n = nodeById(store, id)
          if (!n) return null
          const last = i === trail.length - 1
          return (
            <span key={id} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span className="shrink-0 select-none text-line-strong">›</span>}
              <button
                type="button"
                onClick={() => onSelect(id)}
                disabled={last}
                // 悬停显示该节点的描述（描述不再占用正文版面）
                title={n.description ? `${n.title}\n\n${plainSnippet(n.description, 600)}` : n.title}
                className={`max-w-[120px] truncate rounded px-1 py-px transition ${
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
  onSubmit: (q: string, files?: PendingFile[]) => void
  /** 模型选择器改了全局默认后的回调（外层据此刷新 hasKey 等派生状态） */
  onModelChanged: () => void
}) {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const addFiles = (newFiles: PendingFile[]) => {
    if (!newFiles.length) return
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + '_' + f.bytes))
      const toAdd = newFiles.filter((f) => !existing.has(f.name + '_' + f.bytes))
      return [...prev, ...toAdd]
    })
  }

  const handlePickAttach = async () => {
    // 桌面端环境：统一走 Electron 原生文件选择对话框，绝不触发 input.click 导致弹出双窗口
    if (isElectron()) {
      try {
        const res = await native().local.pickAttach()
        if (!res || !res.ok || !res.paths?.length) return
        const picked: PendingFile[] = []
        for (const p of res.paths) {
          const read = await native().local.readAttach(p)
          if (read.ok) {
            const item = pendingFromRead(read, p)
            if (item) picked.push(item)
          }
        }
        if (picked.length > 0) {
          addFiles(picked)
        }
      } catch (err) {
        console.error('Electron pickAttach failed:', err)
      }
      return
    }

    // 纯 Web 环境：走浏览器 input 元素
    fileInputRef.current?.click()
  }

  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || !list.length) return
    const picked: PendingFile[] = []
    for (let i = 0; i < list.length; i++) {
      picked.push(await pendingFromFile(list[i]))
    }
    addFiles(picked)
    e.target.value = ''
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
    const droppedFiles = e.dataTransfer.files
    if (!droppedFiles || !droppedFiles.length) return
    const picked: PendingFile[] = []
    for (let i = 0; i < droppedFiles.length; i++) {
      picked.push(await pendingFromFile(droppedFiles[i]))
    }
    addFiles(picked)
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault()
      const pasted: PendingFile[] = []
      for (let i = 0; i < e.clipboardData.files.length; i++) {
        pasted.push(await pendingFromFile(e.clipboardData.files[i]))
      }
      addFiles(pasted)
    }
  }

  const submit = () => {
    const text = value.trim()
    if ((!text && files.length === 0) || busy) return
    onSubmit(text, files.length > 0 ? files : undefined)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-card px-6 py-10">
      {/* 背景粒子与“归一”回溯心流动画 */}
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
              {t('写下想弄懂的问题或上传参考资料，超级导师会陪你从基础逐层逆向拆解并回溯归一')}
            </p>
          </div>
        </div>

        {/*
          输入区卡片：参照 Agent 栏 Composer 结构与视觉风格，
          附件栏置顶横向排列、无斜杠菜单、左下角为上传附件按钮
        */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDraggingOver(true)
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={handleDrop}
          onPaste={handlePaste}
          className={`mt-5 rounded-2xl border bg-transparent backdrop-blur-[2px] transition ${
            isDraggingOver
              ? 'border-seal/60 ring-2 ring-seal/20'
              : 'border-line/80 focus-within:border-seal/50 focus-within:ring-2 focus-within:ring-seal/10'
          }`}
        >
          {/* 待发送附件列表：与 Agent 栏 Composer 一致置于文字区上方 */}
          {files.length > 0 && (
            <div className="flex items-center gap-2 border-b border-line/60 px-2.5 py-2">
              <div className="moji-scroll-x flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                {files.map((file) => (
                  <FileChip key={file.id} file={file} onRemove={() => removeFile(file.id)} />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setFiles([])}
                title={t('移除全部附件')}
                className="shrink-0 rounded-md px-1.5 py-1 text-[10.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
              >
                {t('清空')}
              </button>
            </div>
          )}

          <div className="relative">
            <textarea
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                // 直接 Enter 就开讲（Shift+Enter 换行）；输入法组字期间不拦
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={files.length > 0 ? 3 : 4}
              placeholder={
                files.length > 0
                  ? t('已添加附件。可在输入框补充说明（例如：根据附件资料制定学习计划），直接回车亦可开始…')
                  : t('例如：为什么 Transformer 能处理长距离依赖？')
              }
              className="block min-h-[80px] w-full resize-none rounded-t-2xl bg-transparent px-3.5 pt-3 pb-2 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
              {...NO_AUTOFILL}
            />
          </div>

          <div className="flex items-center gap-2 rounded-b-2xl px-2.5 py-2">
            {/* 左侧：原 Composer 更多菜单位置，替换为上传附件按钮 */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onFileInputChange}
            />
            <button
              type="button"
              onClick={handlePickAttach}
              title={t('上传附件（支持图片、Markdown、TXT、代码等）')}
              aria-label={t('上传附件')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-line/60 hover:text-ink"
            >
              <Paperclip size={16} />
            </button>
            {isDraggingOver && (
              <span className="text-[11.5px] font-medium text-seal animate-pulse">
                {t('松开鼠标放入文件')}
              </span>
            )}

            {/* 右侧：提供商/模型选择 + 开始学习按钮 */}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <ModelPicker onChanged={onModelChanged} />
              <button
                type="button"
                onClick={submit}
                disabled={(!value.trim() && files.length === 0) || busy}
                title={t('开始学习（Enter）')}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-paper shadow-sm transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-35"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
              </button>
            </div>
          </div>
        </div>

        {/* 底部快捷键与拖拽说明 */}
        <div className="mt-3 flex items-center justify-between text-[11px] text-ink-faint">
          <span>{t('支持点击添加、拖入或粘贴文件作为目标参考')}</span>
          <span>{t('Enter 开始 · Shift + Enter 换行')}</span>
        </div>
      </div>
    </div>
  )
}
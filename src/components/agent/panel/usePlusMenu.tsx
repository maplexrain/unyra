/**
 * 「+」菜单的状态机与两张菜单表。
 *
 * 从 PlusMenu.tsx 里整段搬出来（那边只留怎么画）：展开 / 退场（usePresence 由 useComposer 持有）、
 * 停在哪一级、正在滑出的那一层、面板高度、点别处与 Esc 的收起。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  ChevronRight,
  FlaskConical,
  Flame,
  Globe,
  MessagesSquare,
  Paperclip,
  Settings,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react'
import type { Conversation } from '../../../agent/types'
import { NewChatIcon } from '../../icons'
import { MENU_SLIDE_MS } from './constants'
import type { MenuItem, MenuSub } from './types'
import { t } from '../../../i18n'

export interface PlusMenuArgs {
  conversations: Conversation[]
  conversation: Conversation | null
  running: boolean
  hasKey: boolean
  compacting: boolean
  /** 自动压缩阈值（0~1），菜单项上如实说明「到多少会自己压」 */
  compactThreshold: number
  menuOpen: boolean
  menuMounted: boolean
  menuClosing: boolean
  setMenuOpen: (next: boolean) => void
  /**
   * 四个挂载回调（名字都不带 Ref / Panel 这类会被 react(refs) 当成 ref 的写法）：
   * 它们把节点登记到内部 ref 上，渲染期传出去的只是函数本身。
   *
   * 「+」那颗按钮自己（点在它上面不算「点别处」）
   */
  buttonMount: (el: HTMLButtonElement | null) => void
  /** 弹出来的那一块自己：同上 */
  panelMount: (el: HTMLDivElement | null) => void
  onNewConversation: () => void
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  /** 更多 → 工作流 → 回忆：请超级导师带用户做一次主动回忆 */
  onRecall: () => void
  /** 更多 → 工作流 → 超级实验室 */
  onSuperLab: () => void
  /** 更多 → 工作流 → 打卡 */
  onCheckin: () => void
  /** 更多 → 工作流 → 浏览器操作：替用户驱动内置浏览器完成任务 */
  onBrowserUse: () => void
  /** 更多 → 压缩上下文：把前面的对话折成一份摘要 */
  onCompact: () => void
  /** 更多 → 超级导师设置：打开超级导师自己的设置窗口（与全局设置不是同一个） */
  onOpenAgentSettings: () => void
  /** 更多 → 文件：走系统对话框挑附件（由 useComposer 提供） */
  onAttach: () => void
}

export interface PlusMenuApi {
  /** 现在停在哪一级：null = 一级；二级只有「工作流」与「对话历史」两项 */
  menuSub: MenuSub
  /** 逻辑上的展开状态（那颗「+」的 aria-expanded 与高亮都看它） */
  menuOpen: boolean
  /** 要不要渲染：收起后先播退场动画，播完才由 usePresence 置 false */
  menuMounted: boolean
  /** 正在播退场动画（那时断掉指针事件） */
  menuClosing: boolean
  /** 正在滑出的那一层，以及滑动方向（与 ModelPicker 的换层是同一套做法） */
  menuLeaving: { sub: MenuSub; dir: 1 | -1 } | null
  menuDir: 1 | -1
  /** 面板高度：两层的内容不一样高，量出来做高度过渡，换层时面板才不会跳 */
  menuBodyH: number | null
  buttonMount: (el: HTMLButtonElement | null) => void
  panelMount: (el: HTMLDivElement | null) => void
  /** 当前这一层自己：量高度用（面板高度要跟着它走） */
  panelBodyMount: (el: HTMLDivElement | null) => void
  /** 打开 / 收起：收起走 usePresence（先播退场再卸载），打开时回到一级 */
  toggle: () => void
  /** 一层的内容。抽成函数是因为过渡期间要同时渲染"新来的"与"正走的"两层 */
  renderMenuPanel: (sub: MenuSub) => ReactNode
  /** 面包屑上的「更多」：退回一级 */
  goRoot: () => void
  /** 那颗「+」按钮上的高亮类 */
  plusButtonClass: string
}

export function usePlusMenu({
  conversations,
  conversation,
  running,
  hasKey,
  compacting,
  compactThreshold,
  menuOpen,
  menuMounted,
  menuClosing,
  setMenuOpen,
  buttonMount,
  panelMount,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onRecall,
  onSuperLab,
  onCheckin,
  onBrowserUse,
  onCompact,
  onOpenAgentSettings,
  onAttach,
}: PlusMenuArgs): PlusMenuApi {
  /** 现在停在哪一级：null = 一级；二级只有「工作流」与「对话历史」两项 */
  const [menuSub, setMenuSub] = useState<MenuSub>(null)
  /** 正在滑出的那一层，以及滑动方向（与 ModelPicker 的换层是同一套做法） */
  const [menuLeaving, setMenuLeaving] = useState<{ sub: MenuSub; dir: 1 | -1 } | null>(null)
  const [menuDir, setMenuDir] = useState<1 | -1>(1)
  /** 面板高度：两层的内容不一样高，量出来做高度过渡，换层时面板才不会跳 */
  const [menuBodyH, setMenuBodyH] = useState<number | null>(null)
  const menuLeaveTimer = useRef<number | null>(null)
  const btnEl = useRef<HTMLButtonElement | null>(null)
  const panelEl = useRef<HTMLDivElement | null>(null)
  const panelBodyEl = useRef<HTMLDivElement | null>(null)

  /**
   * 「+」菜单里的项目（一级）。
   *
   * 做成一张表而不是写死一串按钮：加一项就是往数组里加一条——渲染、换层、关闭
   * 的逻辑都不用动。带 sub 的那两项**不执行动作，往下一层走**（见 goMenu）。
   *
   * 「上下文」相关的只留「压缩上下文」在一级：它是随时可能顺手点一下的动作；
   * 而回忆 / 超级实验室 / 打卡三件事都是"发起一轮工作流"，归到「工作流」底下。
   */
  const COMPOSER_MENU: MenuItem[] = [
    {
      key: 'new-chat',
      label: t('新建对话'),
      hint: t('同一个目标，另起一段上下文'),
      icon: <NewChatIcon />,
      run: onNewConversation,
    },
    {
      key: 'history',
      label: t('对话历史'),
      hint: conversations.length > 1 ? t('{0} 段', conversations.length) : undefined,
      icon: <MessagesSquare size={14} />,
      sub: 'history',
    },
    {
      key: 'attach',
      label: t('文件'),
      hint: t('把文件发给导师看（也可以直接拖进来）'),
      icon: <Paperclip size={14} />,
      run: onAttach,
    },
    {
      key: 'workflow',
      label: t('工作流'),
      hint: t('回忆 / 浏览器操作 / 打卡'),
      icon: <Zap size={14} />,
      sub: 'workflow',
    },
    {
      key: 'compact',
      label: t('压缩上下文'),
      hint: compacting
        ? t('正在压缩…')
        : t('折成摘要继续聊（自动压缩阈值 {0}%）', Math.round(compactThreshold * 100)),
      icon: <Archive size={14} />,
      disabled: compacting || running,
      run: onCompact,
    },
    {
      key: 'settings',
      label: t('超级导师设置'),
      hint: t('压缩阈值等（与全局设置分开）'),
      icon: <Settings size={14} />,
      run: onOpenAgentSettings,
    },
  ]

  /**
   * 「工作流」二级菜单：三件"请导师带我做点什么"的事。
   *
   * 与文档区那几颗悬浮按钮是同一件事（回忆 / 出题），但这里**不二次确认**：
   * 那边是鼠标扫过顺手点一下，这里是用户翻菜单主动找出来的——误触概率差着一个量级。
   */
  const WORKFLOW_MENU: MenuItem[] = [
    {
      key: 'recall',
      label: t('回忆'),
      hint: t('合上文档，讲一遍'),
      icon: <Sparkles size={14} />,
      disabled: running || !hasKey,
      run: onRecall,
    },
    {
      key: 'superlab',
      label: t('超级实验室'),
      hint: t('说想要什么实验，导师做成可交互的超级文档'),
      icon: <FlaskConical size={14} />,
      disabled: running || !hasKey,
      run: onSuperLab,
    },
    {
      key: 'checkin',
      label: t('打卡'),
      hint: t('用今天读到的内容出几道题，答到门槛才算过'),
      icon: <Flame size={14} />,
      disabled: running || !hasKey,
      run: onCheckin,
    },
    {
      key: 'browser-use',
      label: t('浏览器操作'),
      hint: t('说清要在网页上做什么，导师用内置浏览器代办'),
      icon: <Globe size={14} />,
      disabled: running || !hasKey,
      run: onBrowserUse,
    },
  ]

  /** 一层里的一项：带 sub 的往下一层走（右边一个箭头），其余的点一下就执行 */
  const menuItem = (item: MenuItem) => (
    <button
      key={item.key}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      title={item.hint}
      onClick={() => {
        if (item.sub) {
          goMenu(item.sub)
          return
        }
        setMenuOpen(false)
        item.run?.()
      }}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-ink transition hover:bg-line/60 disabled:pointer-events-none disabled:opacity-40"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint">
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.hint && <span className="shrink-0 text-[10.5px] text-ink-faint">{item.hint}</span>}
      {item.sub && <ChevronRight size={13} className="shrink-0 text-ink-faint" />}
    </button>
  )

  /**
   * 换一层：与 ModelPicker 同一套（记住方向与"正在离开的那一层"，滑完再把它丢掉）。
   * 往里走是 forward（新层自左滑入、旧层向右滑出），退回一级是 back（方向相反）。
   */
  const goMenu = (next: MenuSub) => {
    if (next === menuSub) return
    const d: 1 | -1 = next === null ? -1 : 1
    setMenuDir(d)
    setMenuLeaving({ sub: menuSub, dir: d })
    setMenuSub(next)
    if (menuLeaveTimer.current !== null) window.clearTimeout(menuLeaveTimer.current)
    menuLeaveTimer.current = window.setTimeout(() => {
      menuLeaveTimer.current = null
      setMenuLeaving(null)
    }, MENU_SLIDE_MS)
  }

  useEffect(
    () => () => {
      if (menuLeaveTimer.current !== null) window.clearTimeout(menuLeaveTimer.current)
    },
    [],
  )

  /**
   * 面板高度跟着**当前这一层**的内容走。
   *
   * 两层是绝对定位叠着做滑动的，不把外层定高就会塌成 0；高度还得跟着内容变
   * （对话列表多一段就高一截），所以用 ResizeObserver 盯住当前那一层，
   * 且只在真的变了时才写回 state（每次回调都写会白白重渲染一遍）。
   */
  useLayoutEffect(() => {
    const el = panelBodyEl.current
    if (!menuMounted || !el) return
    const sync = () => setMenuBodyH((prev) => (prev === el.offsetHeight ? prev : el.offsetHeight))
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
    // panelBodyEl 是 ref：这里读的是当下挂上的那一层
  }, [menuMounted, menuSub, conversations.length])

  /**
   * 每段对话的「可见条数」（菜单上那个「N 条消息」）。
   *
   * 为什么可以这么省：这个数只由每条消息自己的 hidden 标记决定，而 hidden 是消息**创建时**
   * 定下的（导师的内部指令那种），此后不会再变——真变了也必然是换了一个新的 messages 数组，
   * 也就换了一个新的 conversations（store 的更新一律整份换新，见 learn/store），缓存当场失效。
   * 于是按对话列表缓存一次就够，不必每次渲染都把**所有对话的所有消息**（含压缩掉的几千条）
   * 重新 filter 一遍：数出来的值与 filter(...).length 逐字相同，只是不再每轮重数。
   */
  const visibleCounts = useMemo(
    () =>
      conversations.map((c) => {
        // 一次遍历数一遍，不额外分配中间数组
        let n = 0
        for (const m of c.messages) if (!m.hidden) n++
        return n
      }),
    [conversations],
  )

  /**
   * 「对话历史」二级菜单：当前目标下的全部对话。
   *
   * 只列这一段目标自己的对话（上下文是按目标隔离的，别的目标那几段与这里无关）。
   * 标题是模型起的（见 learn/title），还没起好就退回「对话 N」。
   *
   * 顶部摆一颗「新建对话」：翻到这一层的人多半在找「上一段聊到哪了」，而
   * 「另起一段」与「挑一段旧的」是同一件事的两面——回到一级再点一次反而绕。
   */
  const conversationRows = (
    <div>
      <div className="p-1 pb-0.5">
        <button
          type="button"
          role="menuitem"
          title={t('同一个目标，另起一段上下文')}
          onClick={() => {
            setMenuOpen(false)
            onNewConversation()
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-ink transition hover:bg-line/60"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint">
            <NewChatIcon />
          </span>
          <span className="min-w-0 flex-1 truncate">{t('新建对话')}</span>
        </button>
      </div>
      <span aria-hidden="true" className="mx-2 mb-1 block h-px bg-line" />
      {/* 对话多了就在这一层里滚：面板是往上长的，一屏塞不下十几段对话 */}
      <div className="max-h-[300px] overflow-y-auto">
      {conversations.map((c, i) => {
        const count = visibleCounts[i]
        const active = c.id === conversation?.id
        return (
          <div
            key={c.id}
            className={'group/c flex items-center gap-1 rounded-lg px-1 transition ' + (active ? 'bg-line/40' : 'hover:bg-line/40')}
          >
            <button
              type="button"
              onClick={() => {
                onSelectConversation(c.id)
                setMenuOpen(false)
              }}
              className={'min-w-0 flex-1 px-1.5 py-1.5 text-left text-[12px] ' + (active ? 'font-medium text-ink-strong' : 'text-ink')}
            >
              <span className="block truncate">{c.title || t('对话 {0}', i + 1)}</span>
              <span className="block text-[10.5px] text-ink-faint">
                {count ? t('{0} 条消息', count) : t('还没有消息')}
              </span>
            </button>
            {conversations.length > 1 && (
              <button
                type="button"
                title={t('删除该对话')}
                onClick={() => onDeleteConversation(c.id)}
                className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-seal group-hover/c:flex"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )

  /** 一层的内容。抽成函数是因为过渡期间要同时渲染"新来的"与"正走的"两层 */
  const renderMenuPanel = (sub: MenuSub) => {
    if (sub === 'workflow') return WORKFLOW_MENU.map(menuItem)
    if (sub === 'history') return conversationRows
    return COMPOSER_MENU.map(menuItem)
  }

  /**
   * 点别处 / 按 Esc 都收起「+」菜单。判据是**整个菜单组件**（那颗按钮 + 弹出来的那一块），
   * 而不是只看按钮。
   *
   * 只看按钮会漏掉一半：点在菜单项上时，mousedown 先到 document，菜单当场被卸载，
   * 紧接着的 click 就落在一个已经不存在的按钮上——**功能永远不会被触发**，
   * 而界面上看起来只是「菜单关掉了」。所以那一块也得算「自己人」。
   * 顺序也是有意的：mousedown 就该有反应（与页签菜单、节点右键菜单同一条规则），
   * 等到 click 才收会让浮层跟着一次拖拽多活一会儿。
   */
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnEl.current?.contains(target) || panelEl.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
    // btnEl / panelEl 是 ref：读的是当下挂在 DOM 上的那两个节点。
    // setMenuOpen 来自 usePresence，身份稳定（内部是 useCallback）；写进来只是让规则看得见
  }, [menuOpen, setMenuOpen])

  return {
    menuSub,
    menuOpen,
    menuMounted,
    menuClosing,
    menuLeaving,
    menuDir,
    menuBodyH,
    buttonMount: (el) => {
      btnEl.current = el
      buttonMount(el)
    },
    panelMount: (el) => {
      panelEl.current = el
      panelMount(el)
    },
    panelBodyMount: (el) => {
      panelBodyEl.current = el
    },
    toggle: () => {
      if (menuOpen) {
        setMenuOpen(false)
        return
      }
      // 打开时回到一级：上次翻到的那一层不该留到下一次（与 ModelPicker 同一条规矩）
      setMenuSub(null)
      setMenuLeaving(null)
      setMenuOpen(true)
    },
    /** 面包屑上的「更多」：退回一级 */
    goRoot: () => goMenu(null),
    renderMenuPanel,
    plusButtonClass: 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ' +
      (menuOpen ? 'bg-line/60 text-ink' : 'text-ink-soft hover:bg-line/60 hover:text-ink'),
  }
}

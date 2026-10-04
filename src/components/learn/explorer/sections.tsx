/**
 * 这个文件负责：侧栏里与知识树、右键菜单无关的那几块小零件——可折叠分区（Section / Collapse）、
 * 本地文件行（LocalRow）、以及「最近打开」那一段（RecentSection / RecentRow）。
 * 它们只被 ExplorerSidebar 直接渲染。
 */
import { useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  Pencil,
  X,
} from 'lucide-react'
import type { FavoriteItem, FavoriteRef, LearnStore, LocalFile } from '../../../learn/types'
import { favoriteKey } from '../../../learn/favorites'
import { useClampToViewport, useDismissOn } from '../../../lib/useDismiss'
import { recentOpens, type RecentOpen } from '../../../learn/recents'
import { useClock } from '../../../lib/clock'
import { relativeTime } from '../../../lib/time'
import { STATUS_META } from '../mastery'
import StatusBranch from '../StatusBranch'
import { DocTypeIcon, WebTabTypeIcon } from '../docTypes'
import { chipJson } from '../../../lib/chipSyntax'
import { t } from '../../../i18n'

/**
 * 「最近打开」：节点与本地文件混排（见 learn/recents），点一下接着看。
 *
 * 单独一个组件只为了一件事：那一列相对时间（「刚刚」→「3 分钟前」）要跟着真实时间走，
 * 而时钟只能订在**用到它的那一小块**上——订在外层，整棵节点树会跟着每 30 秒重渲染一遍
 * （见 lib/clock 的说明）。空列表整块不显示，与本地文件区同一条规矩。
 */
export function RecentSection({
  store,
  open,
  onToggle,
  onSelectNode,
  onOpenLocal,
}: {
  store: LearnStore
  open: boolean
  onToggle: () => void
  onSelectNode: (nodeId: string) => void
  onOpenLocal: (path: string) => void
}) {
  const now = useClock(30_000)
  const items = useMemo(() => recentOpens(store), [store])
  if (!items.length) return null
  return (
    <Section title={t('最近打开')} count={items.length} open={open} onToggle={onToggle}>
      <div className="px-2">
        {items.map((item) => (
          <RecentRow
            key={item.kind + ':' + item.id}
            item={item}
            now={now}
            onOpen={() => (item.kind === 'node' ? onSelectNode(item.id) : onOpenLocal(item.id))}
          />
        ))}
      </div>
    </Section>
  )
}

/**
 * 最近打开的一行：状态圆点（节点，与节点树同一套写法）/ 文件图标，标题，它在什么里面，
 * 以及相对时间。完整路径放 title——「我打开的是哪一个 notes.md」在这里同样要紧。
 */
export function RecentRow({ item, now, onOpen }: { item: RecentOpen; now: number; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      title={item.tip}
      className="flex cursor-pointer items-center gap-1.5 py-1.5 pl-1.5 pr-1.5 transition hover:bg-line/40"
    >
      {item.kind === 'node' ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <StatusBranch size={11} className={STATUS_META[item.status ?? 'learning'].mark} />
        </span>
      ) : (
        <DocTypeIcon kind="local" size={13} />
      )}
      {/*
        标题与「在什么里面」挤在同一行里一起截断：标题在前，空间不够时先舍说明。
        分成两栏（标题一栏、说明一栏）会让两条都只剩一半，而这一行里最要紧的
        永远是「这是哪个东西」——同名的 `导数` 靠后面那句淡淡的说明分辨，完整路径在 title 上。
      */}
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
        {item.title}
        {item.hint && <span className="text-[11px] text-ink-faint"> · {item.hint}</span>}
      </span>
      <span className="shrink-0 text-[10.5px] text-ink-faint">{relativeTime(item.at, now)}</span>
    </div>
  )
}

/** 组里整行的一项（右键「移入分组」那张小菜单用） */
const MENU_ROW =
  'flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-2.5 text-left text-[12px] text-ink transition hover:bg-line/60 disabled:opacity-40 disabled:hover:bg-transparent'

/**
 * 收藏区：文档与网页的收藏夹（见 learn/favorites）。
 *
 * 收藏从别处进来：页签的右键菜单、网页地址栏的星标。这里负责**看、去与整理**——
 * 点一行打开它（网页现场开新签），悬停的按钮把它移进分组 / 改名 / 摘出收藏夹。
 * 标题由上层现查（见 favoriteTitle）：改名之后收藏跟着新名字走。
 *
 * **分组文件夹**是网页收藏的管理方式：一条收藏带一个可选的 group 名字（随收藏落盘），
 * 收藏区按它折成一层层文件夹。分组不单独登记——组名长在成员身上，拆组就是把成员
 * 放回顶层，没有「空组」这种东西要清。
 */
export function FavoriteSection({
  items,
  open,
  onToggle,
  titleOf,
  onOpen,
  onRemove,
  onSetGroup,
  onRenameGroup,
  onRemoveGroup,
  onRenameTitle,
}: {
  items: FavoriteItem[]
  open: boolean
  onToggle: () => void
  titleOf: (ref: FavoriteRef) => string
  onOpen: (ref: FavoriteRef) => void
  onRemove: (ref: FavoriteRef) => void
  /** 把一条收藏移进分组（null = 移回顶层）；分组不在这里登记，移过去组就存在了 */
  onSetGroup: (ref: FavoriteRef, group: string | null) => void
  /** 给分组改名：成员原样跟着走 */
  onRenameGroup: (from: string, to: string) => void
  /** 拆掉一个分组：成员回到顶层，收藏一条不丢 */
  onRemoveGroup: (group: string) => void
  /** 改一条网页收藏的显示名（收藏那一刻存的页面标题） */
  onRenameTitle: (ref: FavoriteRef, title: string) => void
}) {
  if (!items.length) return null
  return (
    <Section title={t('收藏')} count={items.length} open={open} onToggle={onToggle}>
      <FavoriteGroups
        items={items}
        titleOf={titleOf}
        onOpen={onOpen}
        onRemove={onRemove}
        onSetGroup={onSetGroup}
        onRenameGroup={onRenameGroup}
        onRemoveGroup={onRemoveGroup}
        onRenameTitle={onRenameTitle}
      />
    </Section>
  )
}

/** 顶层与分组两个层次的全部渲染；state 只活在这一块里（分组展开、改名、移动菜单） */
function FavoriteGroups({
  items,
  titleOf,
  onOpen,
  onRemove,
  onSetGroup,
  onRenameGroup,
  onRemoveGroup,
  onRenameTitle,
}: {
  items: FavoriteItem[]
  titleOf: (ref: FavoriteRef) => string
  onOpen: (ref: FavoriteRef) => void
  onRemove: (ref: FavoriteRef) => void
  onSetGroup: (ref: FavoriteRef, group: string | null) => void
  onRenameGroup: (from: string, to: string) => void
  onRemoveGroup: (group: string) => void
  onRenameTitle: (ref: FavoriteRef, title: string) => void
}) {
  /** 收起状态的分组（默认全展开：文件夹存在的意义就是让人一眼看到里面的东西） */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  /** 「移入分组」菜单弹在哪一条上（比的是收藏身份）；group 为 null 时是「新建分组」的输入态 */
  const [menu, setMenu] = useState<{ key: string; x: number; y: number; newGroup: boolean } | null>(null)
  /** 正在改名的分组 / 网页收藏（inline input） */
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)

  // 顶层（没分组的）与各分组：组按第一次出现的先后排，成员保持收藏的先后
  const { top, groups } = useMemo(() => {
    const top: FavoriteItem[] = []
    const order: string[] = []
    const byGroup = new Map<string, FavoriteItem[]>()
    for (const f of items) {
      if (!f.group) {
        top.push(f)
        continue
      }
      let list = byGroup.get(f.group)
      if (!list) {
        list = []
        byGroup.set(f.group, list)
        order.push(f.group)
      }
      list.push(f)
    }
    return { top, groups: order.map((name) => ({ name, items: byGroup.get(name) ?? [] })) }
  }, [items])

  const toggleGroup = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const menuKey = menu ? (items.find((f) => favoriteKey(f) === menu.key) ?? null) : null
  const groupNames = groups.map((g) => g.name)

  return (
    <div className="px-2">
      {top.map((f) => (
        <FavRow
          key={favoriteKey(f)}
          item={f}
          title={titleOf(f)}
          renaming={renamingKey === favoriteKey(f)}
          onRenameCommit={(name) => {
            setRenamingKey(null)
            if (name.trim()) onRenameTitle(f, name)
          }}
          onRenameCancel={() => setRenamingKey(null)}
          onOpen={() => onOpen(f)}
          onRemove={() => onRemove(f)}
          onMove={(x, y) => setMenu({ key: favoriteKey(f), x, y, newGroup: false })}
          onRenameStart={() => setRenamingKey(favoriteKey(f))}
        />
      ))}
      {groups.map((g) => (
        <div key={g.name}>
          {renamingGroup === g.name ? (
            <InlineName
              initial={g.name}
              placeholder={t('分组名，回车确认')}
              onCommit={(name) => {
                setRenamingGroup(null)
                if (name.trim() && name.trim() !== g.name) onRenameGroup(g.name, name)
              }}
              onCancel={() => setRenamingGroup(null)}
            />
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggleGroup(g.name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') toggleGroup(g.name)
              }}
              className="group flex cursor-pointer items-center gap-1.5 py-1.5 pl-1 pr-1 transition hover:bg-line/40"
            >
              <ChevronRight
                size={12}
                className={
                  'shrink-0 text-ink-faint transition-transform duration-200 ease-out motion-reduce:transition-none ' +
                  (collapsed.has(g.name) ? '' : 'rotate-90')
                }
              />
              {collapsed.has(g.name) ? (
                <Folder size={13} className="shrink-0 text-ink-faint" />
              ) : (
                <FolderOpen size={13} className="shrink-0 text-ink-faint" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{g.name}</span>
              <span className="shrink-0 text-[11px] text-ink-faint">{g.items.length}</span>
              <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                <button
                  type="button"
                  title={t('重命名分组')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenamingGroup(g.name)
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-ink"
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  title={t('拆掉分组（收藏回到顶层）')}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveGroup(g.name)
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-seal"
                >
                  <FolderMinus size={11} />
                </button>
              </span>
            </div>
          )}
          {!collapsed.has(g.name) &&
            g.items.map((f) => (
              <FavRow
                key={favoriteKey(f)}
                item={f}
                indent
                title={titleOf(f)}
                renaming={renamingKey === favoriteKey(f)}
                onRenameCommit={(name) => {
                  setRenamingKey(null)
                  if (name.trim()) onRenameTitle(f, name)
                }}
                onRenameCancel={() => setRenamingKey(null)}
                onOpen={() => onOpen(f)}
                onRemove={() => onRemove(f)}
                onMove={(x, y) => setMenu({ key: favoriteKey(f), x, y, newGroup: false })}
                onRenameStart={() => setRenamingKey(favoriteKey(f))}
              />
            ))}
        </div>
      ))}

      {menu && menuKey && (
        <GroupMenu
          menu={menu}
          item={menuKey}
          groupNames={groupNames}
          onPick={(group) => {
            onSetGroup(menuKey, group)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

/**
 * 收藏的一行：类型图标（与页签栏同一套）+ 标题 + 悬停的三个动作键。
 * 网页行多了「移入分组」与「改名」；改名是行内输入（同工作区改名一个手感）。
 * 完整的网址 / 路径放 title——「我收藏的是哪个 notes.md、哪一页」悬停就能确认。
 */
function FavRow({
  item,
  title,
  indent,
  renaming,
  onRenameCommit,
  onRenameCancel,
  onOpen,
  onRemove,
  onMove,
  onRenameStart,
}: {
  item: FavoriteItem
  title: string
  /** 在分组里：往右缩一格，层级一眼可见 */
  indent?: boolean
  /** 正在行内改名：整行让给输入框 */
  renaming?: boolean
  onRenameCommit: (name: string) => void
  onRenameCancel: () => void
  onOpen: () => void
  onRemove: () => void
  /** 悬停的「移入分组」键：弹出小菜单（右键同样弹它） */
  onMove?: (x: number, y: number) => void
  onRenameStart?: () => void
}) {
  if (renaming) {
    return (
      <InlineName
        indent={indent}
        initial={item.kind === 'web' ? (item.title ?? title) : title}
        placeholder={t('收藏名，回车确认')}
        onCommit={onRenameCommit}
        onCancel={onRenameCancel}
      />
    )
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      onContextMenu={(e) => {
        if (!onMove) return
        e.preventDefault()
        onMove(e.clientX, e.clientY)
      }}
      title={item.kind === 'web' ? item.url : item.kind === 'local' ? item.path : title}
      className={'group flex cursor-pointer items-center gap-1.5 py-1.5 pr-1 transition hover:bg-line/40 ' + (indent ? 'pl-3.5' : 'pl-1.5')}
    >
      {/* 网页行显示**站点图标**（收藏那一刻记下的 favicon，与页签栏同一颗组件；没记到退回地球），
          其余类型用类型图标——同一个东西在页签栏与收藏夹里长得一样。
          网页包一层 16px 格子与 DocTypeIcon 的占位对齐，标题的左边缘才不会因行而异。 */}
      {item.kind === 'web' ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <WebTabTypeIcon favicon={item.icon} size={13} />
        </span>
      ) : (
        <DocTypeIcon kind={item.kind} size={13} />
      )}
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{title}</span>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        {item.kind === 'web' && onMove && (
          <button
            type="button"
            title={t('移入分组')}
            onClick={(e) => {
              e.stopPropagation()
              onMove(e.clientX, e.clientY)
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-ink"
          >
            <FolderInput size={11} />
          </button>
        )}
        {item.kind === 'web' && onRenameStart && (
          <button
            type="button"
            title={t('改这条收藏显示的名字')}
            onClick={(e) => {
              e.stopPropagation()
              onRenameStart()
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-ink"
          >
            <Pencil size={11} />
          </button>
        )}
      </span>
      <button
        type="button"
        title={t('从收藏里移除')}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-seal group-hover:flex"
      >
        <X size={12} />
      </button>
    </div>
  )
}

/** 行内改名的一条输入框（收藏行 / 分组行共用；Enter 提交、Esc 取消、失焦提交） */
function InlineName({
  initial,
  placeholder,
  indent,
  onCommit,
  onCancel,
}: {
  initial: string
  placeholder: string
  indent?: boolean
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  return (
    <div className={'py-0.5 ' + (indent ? 'pl-3.5' : 'pl-1.5')}>
      <input
        autoFocus
        defaultValue={initial}
        placeholder={placeholder}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(e.currentTarget.value)
          else if (e.key === 'Escape') onCancel()
        }}
        onBlur={(e) => onCommit(e.currentTarget.value)}
        onFocus={(e) => e.target.select()}
        className="h-6 w-full rounded border border-seal/50 bg-card px-1.5 text-[12.5px] text-ink outline-none"
      />
    </div>
  )
}

/**
 * 「移入分组」的小菜单：已有的组一个个列出来（当前所在组打勾），
 * 底下是「新建分组…」——选中后原地变成一条输入框，回车即移入新组。
 */
function GroupMenu({
  menu,
  item,
  groupNames,
  onPick,
  onClose,
}: {
  menu: { x: number; y: number; newGroup: boolean }
  item: FavoriteItem
  groupNames: string[]
  onPick: (group: string | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [creating, setCreating] = useState(menu.newGroup)
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
      className="moji-in-soft fixed z-[70] min-w-[180px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      {creating ? (
        <InlineName
          initial=""
          placeholder={t('新分组名，回车确认')}
          onCommit={(name) => {
            if (name.trim()) onPick(name)
            else onClose()
          }}
          onCancel={onClose}
        />
      ) : (
        <>
          {item.group && (
            <button type="button" role="menuitem" onClick={() => onPick(null)} className={MENU_ROW}>
              <span className="flex w-[14px] shrink-0 items-center justify-center">
                <FolderMinus size={13} className="text-ink-soft" />
              </span>
              {t('移出分组')}
            </button>
          )}
          {groupNames
            .filter((name) => name !== item.group)
            .map((name) => (
              <button key={name} type="button" role="menuitem" onClick={() => onPick(name)} className={MENU_ROW}>
                <span className="flex w-[14px] shrink-0 items-center justify-center">
                  <Folder size={13} className="text-ink-soft" />
                </span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
              </button>
            ))}
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button type="button" role="menuitem" onClick={() => setCreating(true)} className={MENU_ROW}>
            <span className="flex w-[14px] shrink-0 items-center justify-center">
              <FolderInput size={13} className="text-ink-soft" />
            </span>
            {t('新建分组…')}
          </button>
        </>
      )}
      {!creating && item.group && (
        <div className="truncate px-2.5 py-1 text-[10.5px] text-ink-faint">
          {t('现属：{0}', item.group)}
        </div>
      )}
    </div>
  )
}

/**
 * 展开 / 收起的那一段动画。
 *
 * 用 grid-template-rows 从 0fr 到 1fr：这是**唯一**能对「高度未知」的内容做过渡的办法——
 * height 从 0 到 auto 不可动画，而预先量高度要么写死（内容一变就错），要么每帧读一次布局。
 * 内层 overflow-hidden + min-h-0 把内容裁住。
 *
 * 收起时子树**仍然挂着**（只是裁成 0 高），换来的是两个方向都有动画；
 * 树大到几百个节点时这里会成为负担，那时再改成「收起动画播完再卸载」。
 * inert：裁掉的那部分不该还能被 Tab 选中。
 */
export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={
        'grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ' +
        (open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')
      }
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/** 一个可折叠的分区：标题一行 + 内容（见文件头对「为什么分区」的说明） */
export function Section({
  title,
  count,
  open,
  onToggle,
  action,
  children,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-1">
      <div className="group flex items-center gap-1 px-3 py-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-[12.5px] font-medium tracking-wide text-ink-soft uppercase transition hover:text-ink"
        >
          {/* 单箭头旋转（与 Collapse 的高度动画同拍），不再两颗图标硬切换 */}
          <ChevronRight
            size={13}
            className={
              'shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none ' +
              (open ? 'rotate-90' : '')
            }
          />
          <span className="truncate">{title}</span>
          <span className="shrink-0 text-[11.5px] font-normal text-ink-faint normal-case">{count}</span>
        </button>
        {action}
      </div>
      <Collapse open={open}>{children}</Collapse>
    </section>
  )
}

/**
 * 本地文件列表里的一行。
 *
 * 显示的是文件名而不是完整路径（路径太长，侧栏只有 288px）；完整路径放 title，
 * 悬停就能看到——「我打开的到底是哪个 notes.md」是这一行最要紧的信息。
 */
export function LocalRow({
  file,
  onOpen,
  onRemove,
  onMenu,
}: {
  file: LocalFile
  onOpen: () => void
  onRemove: () => void
  onMenu: (x: number, y: number) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      title={file.path}
      // 拖出去 = 外部文件的引用：拖到页签栏开成 l: 页签，拖到输入框是一枚引用
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-moji-chip', chipJson({ type: 'local', path: file.path, title: file.name }))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      className="group flex cursor-pointer items-center gap-1.5 py-1.5 pl-1.5 pr-1 transition hover:bg-line/40"
    >
      <DocTypeIcon kind="local" size={13} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{file.name}</span>
      <button
        type="button"
        title={t('从列表里移除（不会删除文件本身）')}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-seal group-hover:flex"
      >
        <X size={12} />
      </button>
    </div>
  )
}

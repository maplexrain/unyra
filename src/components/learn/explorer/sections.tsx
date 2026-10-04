/**
 * 这个文件负责：侧栏里与知识树、右键菜单无关的那几块小零件——可折叠分区（Section / Collapse）、
 * 本地文件行（LocalRow）、以及「最近打开」那一段（RecentSection / RecentRow）。
 * 它们只被 ExplorerSidebar 直接渲染。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  ExternalLink,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Pencil,
  X,
} from 'lucide-react'
import type { FavoriteItem, FavoriteRef, LearnStore, LocalFile } from '../../../learn/types'
import { chipPayloadOfFavorite, favoriteKey } from '../../../learn/favorites'
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

/** 组里整行的一项（右键菜单用） */
const MENU_ROW =
  'flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-2.5 text-left text-[12px] text-ink transition hover:bg-line/60 disabled:opacity-40 disabled:hover:bg-transparent'

/** 收藏行拖出引用时额外带的一份身份（拖进分组分类只认它，见 FavRow 的 onDragStart） */
const FAV_KEY_MIME = 'application/x-moji-fav'

/**
 * 收藏区：文档与网页的收藏夹（见 learn/favorites）。
 *
 * 收藏从别处进来：页签的右键菜单、网页地址栏的星标。这里负责**看、去与整理**——
 * 点一行打开它；整理动作全部收在**右键菜单**里（移入分组 / 重命名 / 删除），
 * 行上不摆按钮：悬停冒出来的一排键会把 flex-1 的标题挤得重排，看过去就是抖一下。
 *
 * **分组文件夹**：组名登记在 store.favGroups（「新建分组」按钮创建的就是它），
 * 成员身上同时带着自己的组名（FavoriteItem.group）。收藏行可以**拖**：
 * 拖到文档区开页签、拖到对话输入框变引用 chip、拖到某个分组行上快速归类。
 */
export function FavoriteSection({
  items,
  groups,
  open,
  onToggle,
  titleOf,
  onOpen,
  onRemove,
  onSetGroup,
  onRenameGroup,
  onRemoveGroup,
  onRenameTitle,
  onCreateGroup,
}: {
  items: FavoriteItem[]
  /** 分组登记表（store.favGroups）：空组也在这里 */
  groups: string[]
  open: boolean
  onToggle: () => void
  titleOf: (ref: FavoriteRef) => string
  onOpen: (ref: FavoriteRef) => void
  onRemove: (ref: FavoriteRef) => void
  /** 把一条收藏移进分组（null = 移回顶层）；组名不在登记表里就顺手登记 */
  onSetGroup: (ref: FavoriteRef, group: string | null) => void
  /** 给分组改名：登记表与成员一起换 */
  onRenameGroup: (from: string, to: string) => void
  /** 删除分组：成员回到顶层 */
  onRemoveGroup: (group: string) => void
  /** 改一条网页收藏的显示名（收藏那一刻存的页面标题） */
  onRenameTitle: (ref: FavoriteRef, title: string) => void
  /** 新建分组（登记表追加；同名静默不动） */
  onCreateGroup: (name: string) => void
}) {
  if (!items.length && !groups.length) return null
  return (
    <Section
      title={t('收藏')}
      count={items.length}
      open={open}
      onToggle={onToggle}
      action={
        <button
          type="button"
          title={t('新建分组')}
          onClick={() => onCreateGroupClick()}
          className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-ink group-hover:flex"
        >
          <FolderPlus size={12} />
        </button>
      }
    >
      <FavoriteGroups
        items={items}
        groups={groups}
        titleOf={titleOf}
        onOpen={onOpen}
        onRemove={onRemove}
        onSetGroup={onSetGroup}
        onRenameGroup={onRenameGroup}
        onRemoveGroup={onRemoveGroup}
        onRenameTitle={onRenameTitle}
        onCreateGroup={onCreateGroup}
      />
    </Section>
  )

  /** 新建分组的入口在标题行上，而 inline 输入框的 state 在 FavoriteGroups 里：
      借一个自定义事件把「该出输入框了」递进去（两侧隔着 Section，不值得为它抬 props） */
  function onCreateGroupClick(): void {
    window.dispatchEvent(new CustomEvent('moji-fav-new-group'))
  }
}

/** 顶层与分组两个层次的全部渲染；state 只活在这一块里（分组展开、改名、右键菜单、拖拽高亮） */
function FavoriteGroups({
  items,
  groups,
  titleOf,
  onOpen,
  onRemove,
  onSetGroup,
  onRenameGroup,
  onRemoveGroup,
  onRenameTitle,
  onCreateGroup,
}: {
  items: FavoriteItem[]
  groups: string[]
  titleOf: (ref: FavoriteRef) => string
  onOpen: (ref: FavoriteRef) => void
  onRemove: (ref: FavoriteRef) => void
  onSetGroup: (ref: FavoriteRef, group: string | null) => void
  onRenameGroup: (from: string, to: string) => void
  onRemoveGroup: (group: string) => void
  onRenameTitle: (ref: FavoriteRef, title: string) => void
  onCreateGroup: (name: string) => void
}) {
  /** 收起状态的分组（默认全展开：文件夹存在的意义就是让人一眼看到里面的东西） */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  /** 右键菜单：对着一条收藏（key）或一个分组（name） */
  const [menu, setMenu] = useState<
    { kind: 'fav'; key: string; x: number; y: number } | { kind: 'group'; name: string; x: number; y: number } | null
  >(null)
  /** 正在改名的分组 / 网页收藏（inline input，由菜单里的「重命名」触发） */
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  /** 「新建分组」的 inline 输入框开没有（入口在标题行，经 moji-fav-new-group 事件叫开） */
  const [creating, setCreating] = useState(false)
  /** 拖着收藏悬在哪个分组行上（高亮那一行） */
  const [dropGroup, setDropGroup] = useState<string | null>(null)

  // 「新建分组」按钮在 Section 标题行上（FavoriteSection 里），借事件把输入框叫开
  useEffect(() => {
    const open = (): void => setCreating(true)
    window.addEventListener('moji-fav-new-group', open)
    return () => window.removeEventListener('moji-fav-new-group', open)
  }, [])

  // 顶层（没分组的）与各分组：登记表里的组在前（含空组），成员带出来的野组随后；
  // 成员保持收藏的先后
  const { top, groupsAll } = useMemo(() => {
    const top: FavoriteItem[] = []
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
      }
      list.push(f)
    }
    const order: string[] = []
    for (const name of groups) if (byGroup.has(name) || !order.includes(name)) order.push(name)
    for (const name of byGroup.keys()) if (!order.includes(name)) order.push(name)
    return {
      top,
      groupsAll: order.map((name) => ({ name, items: byGroup.get(name) ?? [] })),
    }
  }, [items, groups])

  const toggleGroup = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  /** 收藏行的右键菜单（打开 / 移入分组 / 重命名 / 删除都在里面） */
  const openFavMenu = (f: FavoriteItem) => (x: number, y: number) =>
    setMenu({ kind: 'fav', key: favoriteKey(f), x, y })

  const menuFav = menu?.kind === 'fav' ? (items.find((f) => favoriteKey(f) === menu.key) ?? null) : null

  /** 拖着收藏松手在分组行上：按拖时带出来的收藏身份归类 */
  const onGroupDrop = (group: string) => (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropGroup(null)
    const key = e.dataTransfer.getData(FAV_KEY_MIME)
    if (!key) return
    const item = items.find((f) => favoriteKey(f) === key)
    if (item && item.group !== group) onSetGroup(item, group)
  }

  /** 拖进分组的悬停高亮：只认带着收藏身份的拖拽，别的拖拽（页签、文件）不理 */
  const onGroupDragOver = (group: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(FAV_KEY_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropGroup(group)
  }

  const favRow = (f: FavoriteItem, indent: boolean) => (
    <FavRow
      key={favoriteKey(f)}
      item={f}
      indent={indent}
      title={titleOf(f)}
      renaming={renamingKey === favoriteKey(f)}
      onRenameCommit={(name) => {
        setRenamingKey(null)
        if (name.trim()) onRenameTitle(f, name)
      }}
      onRenameCancel={() => setRenamingKey(null)}
      onOpen={() => onOpen(f)}
      onMenu={openFavMenu(f)}
    />
  )

  return (
    <div className="px-2" onDragLeave={() => setDropGroup(null)}>
      {creating && (
        <InlineName
          initial=""
          placeholder={t('新分组名，回车确认')}
          onCommit={(name) => {
            setCreating(false)
            if (name.trim()) onCreateGroup(name)
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {top.map((f) => favRow(f, false))}
      {groupsAll.map((g) => (
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
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ kind: 'group', name: g.name, x: e.clientX, y: e.clientY })
              }}
              onDragOver={onGroupDragOver(g.name)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropGroup(null)
              }}
              onDrop={onGroupDrop(g.name)}
              className={
                'flex cursor-pointer items-center gap-1.5 py-1.5 pl-1 pr-1 transition hover:bg-line/40 ' +
                (dropGroup === g.name ? 'rounded bg-seal/15 ring-1 ring-seal/50' : '')
              }
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
            </div>
          )}
          {!collapsed.has(g.name) && g.items.map((f) => favRow(f, true))}
        </div>
      ))}

      {menu?.kind === 'fav' && menuFav && (
        <FavMenu
          menu={menu}
          item={menuFav}
          groupNames={groupsAll.map((g) => g.name)}
          onOpen={() => {
            onOpen(menuFav)
            setMenu(null)
          }}
          onSetGroup={(group) => {
            onSetGroup(menuFav, group)
            setMenu(null)
          }}
          onRename={() => {
            setRenamingKey(menu.key)
            setMenu(null)
          }}
          onRemove={() => {
            onRemove(menuFav)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === 'group' && (
        <GroupMenu
          menu={menu}
          onRename={() => {
            setRenamingGroup(menu.name)
            setMenu(null)
          }}
          onRemove={() => {
            onRemoveGroup(menu.name)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

/**
 * 收藏的一行：类型图标 + 标题，**行上没有任何按钮**——打开靠点击，
 * 整理靠右键菜单，拖出去就是引用。完整网址 / 路径放 title，悬停能确认。
 */
function FavRow({
  item,
  title,
  indent,
  renaming,
  onRenameCommit,
  onRenameCancel,
  onOpen,
  onMenu,
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
  onMenu: (x: number, y: number) => void
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
  const payload = chipPayloadOfFavorite(item)
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
      title={item.kind === 'web' ? item.url : item.kind === 'local' ? item.path : title}
      draggable={!!payload}
      onDragStart={(e) => {
        if (!payload) return
        // 两份都带：CHIP_MIME 给文档区 / 输入框（开页签 / 变引用），FAV_KEY_MIME 给
        // 分组行（快速归类时要知道拖的是哪一条收藏）
        e.dataTransfer.setData('application/x-moji-chip', chipJson(payload))
        e.dataTransfer.setData(FAV_KEY_MIME, favoriteKey(item))
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
      className={'flex cursor-pointer items-center gap-1.5 py-1.5 pr-1 transition hover:bg-line/40 ' + (indent ? 'pl-3.5' : 'pl-1.5')}
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
 * 收藏的右键菜单：打开 / 移入分组（已有组逐个列 + 新建分组）/ 重命名 / 删除。
 * 排版与资源管理器行菜单同一套骨架（图标一列 + 左对齐标签）。
 */
function FavMenu({
  menu,
  item,
  groupNames,
  onOpen,
  onSetGroup,
  onRename,
  onRemove,
  onClose,
}: {
  menu: { x: number; y: number }
  item: FavoriteItem
  groupNames: string[]
  onOpen: () => void
  onSetGroup: (group: string | null) => void
  onRename: () => void
  onRemove: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState(false)
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
      className="moji-in-soft fixed z-[70] min-w-[190px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      {picking || creating ? (
        creating ? (
          <InlineName
            initial=""
            placeholder={t('新分组名，回车确认')}
            onCommit={(name) => {
              if (name.trim()) onSetGroup(name)
              else onClose()
            }}
            onCancel={onClose}
          />
        ) : (
          <>
            {item.group && (
              <button type="button" role="menuitem" onClick={() => onSetGroup(null)} className={MENU_ROW}>
                <span className="flex w-[14px] shrink-0 items-center justify-center">
                  <FolderMinus size={13} className="text-ink-soft" />
                </span>
                {t('移出分组')}
              </button>
            )}
            {groupNames
              .filter((name) => name !== item.group)
              .map((name) => (
                <button key={name} type="button" role="menuitem" onClick={() => onSetGroup(name)} className={MENU_ROW}>
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
        )
      ) : (
        <>
          <button type="button" role="menuitem" onClick={onOpen} className={MENU_ROW}>
            <span className="flex w-[14px] shrink-0 items-center justify-center">
              <ExternalLink size={13} className="text-ink-soft" />
            </span>
            {t('打开')}
          </button>
          <button type="button" role="menuitem" onClick={() => setPicking(true)} className={MENU_ROW}>
            <span className="flex w-[14px] shrink-0 items-center justify-center">
              <FolderInput size={13} className="text-ink-soft" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {t('移入分组')}
              {item.group && <span className="text-ink-faint">（{t('现属：{0}', item.group)}）</span>}
            </span>
          </button>
          {item.kind === 'web' && (
            <button type="button" role="menuitem" onClick={onRename} className={MENU_ROW}>
              <span className="flex w-[14px] shrink-0 items-center justify-center">
                <Pencil size={13} className="text-ink-soft" />
              </span>
              {t('重命名')}
            </button>
          )}
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={onRemove}
            className={MENU_ROW + ' text-seal-deep hover:bg-seal/10'}
          >
            <span className="flex w-[14px] shrink-0 items-center justify-center">
              <X size={13} />
            </span>
            {t('从收藏里移除')}
          </button>
        </>
      )}
    </div>
  )
}

/** 分组行的右键菜单：改名 / 删除（成员回顶层） */
function GroupMenu({
  menu,
  onRename,
  onRemove,
  onClose,
}: {
  menu: { x: number; y: number }
  onRename: () => void
  onRemove: () => void
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
      className="moji-in-soft fixed z-[70] min-w-[190px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      <button type="button" role="menuitem" onClick={onRename} className={MENU_ROW}>
        <span className="flex w-[14px] shrink-0 items-center justify-center">
          <Pencil size={13} className="text-ink-soft" />
        </span>
        {t('重命名分组')}
      </button>
      <button
        type="button"
        role="menuitem"
        title={t('收藏回到顶层，分组本身删掉')}
        onClick={onRemove}
        className={MENU_ROW + ' text-seal-deep hover:bg-seal/10'}
      >
        <span className="flex w-[14px] shrink-0 items-center justify-center">
          <FolderMinus size={13} />
        </span>
        {t('删除分组')}
      </button>
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
  onMenu,
}: {
  file: LocalFile
  onOpen: () => void
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
    </div>
  )
}
